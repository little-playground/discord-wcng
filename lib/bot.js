import _ from 'lodash';
import wcngClient from './wcng_client';
import discord from 'discord.js';
import logger from './logger';
import { ConfigurationError } from './errors';
import { formatFromDiscordToWCNG, formatFromWCNGToDiscord } from './formatting';

const REQUIRED_FIELDS_WCNG = ['nickname', 'host'];
const REQUIRED_FIELDS_DISCORD = ['token', 'commandChat', 'commandUsers', 'nickname'];
const patternMatch = /{\$(.+?)}/g;

/**
 * An Bot, that works as a middleman for all communication
 */
class Bot {
  constructor(options) {
    REQUIRED_FIELDS_WCNG.forEach((field) => {
      if (!options.wcng[field]) {
        throw new ConfigurationError(`Missing wcng configuration field`);
      }
    });

    REQUIRED_FIELDS_DISCORD.forEach((field) => {
      if (!options.discord[field]) {
        throw new ConfigurationError(`Missing discord configuration field`);
      }
    });

    this.wcngOptions = {
      forceAuthentication: options.wcng.forceAuthentication || false,
      forceEncrypion: options.wcng.forceEncrypion || false,
      fingerprint: options.wcng.fingerprint || "",
      password: options.wcng.password || "",
      ignore: options.wcng.ignore || [],
      format: options.wcng.format || '<{$discordChannel}><{$displayUsername}> {$text}',
      nickname: options.wcng.nickname, //required
      host: options.wcng.host, //required
      port: options.wcng.port || 6664,
    };

    this.discordOptions = {
      defaultChannel: options.discord.defaultChannel || "",
      ignore: options.discord.ignore || [],
      ignoreID: options.discord.ignoreID || [],
      format: options.discord.format || '<{$author}> {$withMentions}',
      token: options.discord.token, //required
      commandChat: options.discord.commandChat, //required
      commandUsers: options.discord.commandUsers, //required
      nickname: options.discord.nickname, //required
    };

    this.discord = new discord.Client({ autoReconnect: true });
  }

  connect() {
    logger.debug('Connecting to WCNG and Discord');
    this.discord.login(this.discordOptions.token);

    this.wcngClient = new wcngClient(this.wcngOptions);
    this.attachListeners();
  }

  disconnect() {
    this.wcngClient.disconnect();
    this.discord.destroy();
  }

  attachListeners() {
    this.wcngClient.on('connected', () => {
      logger.info('Connected to WCNG');
    });

    this.wcngClient.on('error', () => {
      logger.info('Received error event from WCNG');
    });

    this.wcngClient.on('message', (name, message) => {
      if(!this.ignoredWCNGUser(name)) {
        this.sendToDiscord(name, message);
      }
    });

    this.discord.on('ready', () => {
      logger.info('Connected to Discord');
      this.discord.guilds.cache.each(guild => {
        guild.members.fetch();
      })
    });

    this.discord.on('error', (error) => {
      logger.error('Received error event from Discord', error);
    });

    this.discord.on('warn', (warning) => {
      logger.warn('Received warn event from Discord', warning);
    });

    this.discord.on('message', (message) => {
      if(!this.ignoredDiscordUser(message.author)) {
        let text = this.parseText(message);

        if(text.startsWith(this.discordOptions.commandChat)) {
          this.sendToWCNG(message);
        } else if(text === this.discordOptions.commandUsers) {
          let clients = this.wcngClient.connection.clients;
          let target = ('dm' === message.channel.type) ? message.author : message.channel;

          if(!clients || (clients.length == 0)) {
            target.send("No active wcng clients");
          } else {
            clients.forEach((client) => {
              target.send(client.name);
            });
          }
        } else if('dm' === message.channel.type) {
          //forward all non-command dm messages to wcng
          this.sendToWCNG(message);
        }
      }
    });

    this.discord.on('guildMemberAdd', () => {
      this.discord.guilds.cache.each(guild => {
        guild.members.fetch();
      })
    })

    this.discord.on('guildMemberRemove', () => {
      this.discord.guilds.cache.each(guild => {
        guild.members.fetch();
      })
    })

    if (logger.level === 'debug') {
      this.wcngClient.on('debug', (message) => {
        logger.debug('Received debug event from WCNG', message);
      });

      this.discord.on('debug', (message) => {
        logger.debug('Received debug event from Discord', message);
      });
    }
  }

  static getDiscordNicknameOnServer(user, guild) {
    if (guild) {
      const userDetails = guild.members.cache.get(user.id);
      if (userDetails) {
        return userDetails.nickname || user.username;
      }
    }
    return user.username;
  }

  parseText(message) {
    const text = message.mentions.users.reduce((content, mention) => {
      const displayName = Bot.getDiscordNicknameOnServer(mention, message.guild);
      const userMentionRegex = RegExp(`<@(&|!)?${mention.id}>`, 'g');
      return content.replace(userMentionRegex, `@${displayName}`);
    }, message.content);

    return text
      .replace(/\n|\r\n|\r/g, ' ')
      .replace(/<#(\d+)>/g, (match, channelId) => {
        const channel = this.discord.channels.cache.get(channelId);
        if (channel) return `#${channel.name}`;
        return '#deleted-channel';
      })
      .replace(/<@&(\d+)>/g, (match, roleId) => {
        const role = message.guild.roles.cache.get(roleId);
        if (role) return `@${role.name}`;
        return '@deleted-role';
      })
      .replace(/<a?(:\w+:)\d+>/g, (match, emoteName) => emoteName);
  }

  ignoredWCNGUser(user) {
    //ignore users from ignore list
    this.wcngOptions.ignore.forEach((ignored) => {
      if(0 == user.toLowerCase().localcompare(ignored.toLowerCase())) {
        return true;
      }
    });

    return false;
  }

  ignoredDiscordUser(user) {
    //ignore self
    if(discord.id == this.discord.user.id) {
      return true;
    }

    //ignore bots
    if(user.bot) {
      return true;
    }

    //ignore users from ignore list (by name)
    this.discordOptions.ignore.forEach((ignored) => {
      if(0 == user.username.toLowerCase().localcompare(ignored.toLowerCase())) {
        return true;
      }
    });

    //ignore users from ignore list (by id)
    this.discordOptions.ignoreID.forEach((ignored) => {
      if(user.id == ignored.id) {
        return true;
      }
    });

    return false;
  }

  static substitutePattern(message, patternMapping) {
    return message.replace(patternMatch, (match, varName) => patternMapping[varName] || match);
  }

  sendToWCNG(message) {
    const nickname = Bot.getDiscordNicknameOnServer(message.author, message.guild);
    let isDm = ('dm' === message.channel.type);
    let text = this.parseText(message);

    let textArray = text.split(/(\s+)/);

    if((textArray.length >= 3) || isDm) {
      if(!isDm) {
        text = textArray.slice(2).join('');
      }

      text = formatFromDiscordToWCNG(text);
      
      const patternMap = {
        author: nickname,
        nickname,
        displayUsername: nickname,
        text,
        discordChannel: isDm ? `@${this.discord.user.username}` : `#${message.channel.name}`
      };

      text = Bot.substitutePattern(this.wcngOptions.format, patternMap);
      logger.debug('Sending message to WCNG', text);
      this.wcngClient.sendMsg(text);
    }
  }

  splitChannelAndMessage(text) {
    let textArray = text.split(/(\s+)/);
    let channelString;

    if(textArray.length < 3) {
      return [null,null];
    }

    if(!textArray[0].startsWith('#') && !textArray[0].startsWith('@')) {
      return [null,null];
    }

    if(textArray[0].length === 1) {
      if(this.discordOptions.defaultChannel !== "") {
        channelString = this.discordOptions.defaultChannel;
      } else {
        return [null,null];
      }
    } else {
      channelString = textArray[0];
    }

    return [channelString, textArray.slice(2).join('')];
  }

  findDiscordChannel(text) {
    let channel = null;
    let name = null;

    if (text.startsWith('#')) {
      //try exact fit
      channel = this.discord.channels.cache
        .filter(c => c.type === 'text')
        .find(c => c.name === text.slice(1));
      
      //try case insensitive fit
      if(!channel) {
        channel = this.discord.channels.cache
          .filter(c => c.type === 'text')
          .find(c => c.name.toUpperCase() === text.slice(1).toUpperCase());
      }

      //try case insensitive substring fit
      if(!channel) {
        channel = this.discord.channels.cache
          .filter(c => c.type === 'text')
          .find(c => c.name.toUpperCase().includes(text.slice(1).toUpperCase()));
      }

      if(channel) {
        name = channel.name;
      }
    } else if(text.startsWith('@')) {
      this.discord.guilds.cache.each(guild => {
        guild.members.cache.each((member) => {
          if(member.displayName) {
            if(member.displayName === text.slice(1)) {
              channel = member;
              name = member.displayName;
            } else if (member.displayName.toUpperCase() === text.slice(1).toUpperCase()) {
              channel = member;
              name = member.displayName;
            } else if(member.displayName.toUpperCase().includes(text.slice(1).toUpperCase())) {
              channel = member;
              name = member.displayName;
            }
          }
        })
      })

      if(this.discord.user.id === channel.id) {
        channel = null;
        name = null;
      }
    }

    if (!channel) {
      logger.info(
        'Tried to send a message to a unknown target: ',
        text
      );
    }

    return [channel, name];
  }

  sendToDiscord(author, text) {
    // Do not send to Discord if this user is on the ignore list.
    if (this.ignoredWCNGUser(author)) {
      return;
    }

    {
      let split = this.splitChannelAndMessage(text);

      if((null == split[0]) || (null == split[1])) {
        return null;
      }

      var channelName = split[0];
      var message = split[1];
    }

    // fetch discord channel
    let channel = this.findDiscordChannel(channelName);
    // Do not send 
    if (!channel[0]) {
      return;
    }

    let target = channel[0];
    let name = channel[1];

    // Convert text formatting
    const withFormat = formatFromWCNGToDiscord(message);

    const patternMap = {
      author,
      nickname: author,
      displayUsername: author,
      text: withFormat,
      discordChannel: `#${name}`,
      withMentions: withFormat,
    };

    // Add bold formatting:
    // Use custom formatting from config / default formatting with bold author
    const withAuthor = Bot.substitutePattern(this.discordOptions.format, patternMap);
    logger.debug('Sending message to Discord', withAuthor, '->', `#${name}`);
    target.send(withAuthor);
  }
}

export default Bot;
