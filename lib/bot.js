import _ from 'lodash';
import wcngClient from './wcng_client';
import discord from 'discord.js';
import logger from './logger';
import { ConfigurationError } from './errors';
import { formatFromDiscordToWCNG, formatFromWCNGToDiscord } from './formatting';

const REQUIRED_FIELDS_WCNG = ['nickname', 'host'];
const REQUIRED_FIELDS_DISCORD = ['token', 'command', 'nickname'];
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
      command: options.discord.command, //required
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
    });

    this.discord.on('error', (error) => {
      logger.error('Received error event from Discord', error);
    });

    this.discord.on('warn', (warning) => {
      logger.warn('Received warn event from Discord', warning);
    });

    this.discord.on('message', (message) => {
      if(!this.ignoredDiscordUser(message.author)) {
        this.sendToWCNG(message);
      }
    });

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
    let text = this.parseText(message);

    if(text.startsWith(this.discordOptions.command)) {
      let textArray = text.split(/(\s+)/);

      if(textArray.length >= 3) {
        text = formatFromDiscordToWCNG(textArray.slice(2).join(''));
        
        const patternMap = {
          author: nickname,
          nickname,
          displayUsername: nickname,
          text,
          discordChannel: `#${message.channel.name}`
        };

        text = Bot.substitutePattern(this.wcngOptions.format, patternMap);
        logger.debug('Sending message to WCNG', text);
        this.wcngClient.sendMsg(text);
      }
    }
  }

  splitChannelAndMessage(text) {
    let textArray = text.split(/(\s+)/);
    let channelString;

    if(textArray.length < 3) {
      return [null,null];
    }

    if(!textArray[0].startsWith('#')) {
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

    if (text.startsWith('#')) {
      channel = this.discord.channels.cache
        .filter(c => c.type === 'text')
        .find(c => c.name === text.slice(1));
    }

    if (!channel) {
      logger.info(
        'Tried to send a message to a channel the bot isn\'t in: ',
        text
      );
    }

    return channel;
  }

  // compare two strings case-insensitively
  // for discord mention matching
  static caseComp(str1, str2) {
    return str1.toUpperCase() === str2.toUpperCase();
  }

  // check if the first string starts with the second case-insensitively
  // for discord mention matching
  static caseStartsWith(str1, str2) {
    return str1.toUpperCase().startsWith(str2.toUpperCase());
  }

  sendToDiscord(author, text) {
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
    if (!channel) {
      return;
    }

    // Do not send to Discord if this user is on the ignore list.
    if (this.ignoredWCNGUser(author)) {
      return;
    }

    // Convert text formatting
    const withFormat = formatFromWCNGToDiscord(message);

    const { guild } = channel;
    const withMentions = withFormat.replace(/@([^\s#]+)#(\d+)/g, (match, username, discriminator) => {
      // @username#1234 => mention
      // skips usernames including spaces for ease (they cannot include hashes)
      // checks case insensitively as Discord does
      const user = guild.members.cache.find(x =>
        Bot.caseComp(x.user.username, username)
        && x.user.discriminator === discriminator);
      if (user) return user;

      return match;
    }).replace(/^([^@\s:,]+)[:,]|@([^\s]+)/g, (match, startRef, atRef) => {
      const reference = startRef || atRef;

      // this preliminary stuff is ultimately unnecessary
      // but might save time over later more complicated calculations
      // @nickname => mention, case insensitively
      const nickUser = guild.members.cache.find(x =>
        x.nickname && Bot.caseComp(x.nickname, reference));
      if (nickUser) return nickUser;

      // @username => mention, case insensitively
      const user = guild.members.cache.find(x => Bot.caseComp(x.user.username, reference));
      if (user) return user;

      // @role => mention, case insensitively
      const role = guild.roles.cache.find(x => x.mentionable && Bot.caseComp(x.name, reference));
      if (role) return role;

      // No match found checking the whole word. Check for partial matches now instead.
      // @nameextra => [mention]extra, case insensitively, as Discord does
      // uses the longest match, and if there are two, whichever is a match by case
      let matchLength = 0;
      let bestMatch = null;
      let caseMatched = false;

      // check if a partial match is found in reference and if so update the match values
      const checkMatch = function (matchString, matchValue) {
        // if the matchString is longer than the current best and is a match
        // or if it's the same length but it matches by case unlike the current match
        // set the best match to this matchString and matchValue
        if ((matchString.length > matchLength && Bot.caseStartsWith(reference, matchString))
          || (matchString.length === matchLength && !caseMatched
              && reference.startsWith(matchString))) {
          matchLength = matchString.length;
          bestMatch = matchValue;
          caseMatched = reference.startsWith(matchString);
        }
      };

      // check users by username and nickname
      guild.members.cache.forEach((member) => {
        checkMatch(member.user.username, member);
        if (bestMatch === member || !member.nickname) return;
        checkMatch(member.nickname, member);
      });
      // check mentionable roles by visible name
      guild.roles.cache.forEach((member) => {
        if (!member.mentionable) return;
        checkMatch(member.name, member);
      });

      // if a partial match was found, return the match and the unmatched trailing characters
      if (bestMatch) return bestMatch.toString() + reference.substring(matchLength);

      return match;
    }).replace(/:(\w+):/g, (match, ident) => {
      // :emoji: => mention, case sensitively
      const emoji = guild.emojis.cache.find(x => x.name === ident && x.requiresColons);
      if (emoji) return emoji;

      return match;
    }).replace(/#([^\s#@'!?,.]+)/g, (match, channelName) => {
      // channel names can't contain spaces, #, @, ', !, ?, , or .
      // (based on brief testing. they also can't contain some other symbols,
      // but these seem likely to be common around channel references)

      // discord matches channel names case insensitively
      const chan = guild.channels.cache.find(x => Bot.caseComp(x.name, channelName));
      return chan || match;
    });

    const patternMap = {
      author,
      nickname: author,
      displayUsername: author,
      text: withFormat,
      discordChannel: `#${channel.name}`,
      withMentions: withMentions,
    };

    // Add bold formatting:
    // Use custom formatting from config / default formatting with bold author
    const withAuthor = Bot.substitutePattern(this.discordOptions.format, patternMap);
    logger.debug('Sending message to Discord', withAuthor, '->', `#${channel.name}`);
    channel.send(withAuthor);
  }
}

export default Bot;
