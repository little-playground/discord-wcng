import _ from 'lodash';
import wcngClient from './wcng_client';
import discord from 'discord.js';
import logger from './logger';
import { ConfigurationError } from './errors';
import { formatFromDiscordToWCNG, formatFromWCNGToDiscord } from './formatting';

const REQUIRED_FIELDS = ['server', 'nickname', 'discordToken', 'discordChannel'];
const patternMatch = /{\$(.+?)}/g;

/**
 * An Bot, that works as a middleman for all communication
 */
class Bot {
  constructor(options) {
    REQUIRED_FIELDS.forEach((field) => {
      if (!options[field]) {
        throw new ConfigurationError(`Missing configuration field ${field}`);
      }
    });

    this.discord = new discord.Client({
      autoReconnect: true,
      retryLimit: 3,
    });

    this.server = options.server;
    this.nickname = options.nickname;
    this.discordToken = options.discordToken;
    this.discordChannel = options.discordChannel;
    this.wcng = {
      socket: {
        server : options.server,
      }
    };

    // Nicks to ignore
    this.ignoreUsers = options.ignoreUsers || {};
    this.ignoreUsers.wcng = this.ignoreUsers.wcng || [];
    this.ignoreUsers.discord = this.ignoreUsers.discord || [];
    this.ignoreUsers.discordIds = this.ignoreUsers.discordIds || [];

    // "{$keyName}" => "variableValue"
    // author/nickname: nickname of the user who sent the message
    // discordChannel: Discord channel (e.g. #general)
    // ircChannel: IRC channel (e.g. #irc)
    // text: the (appropriately formatted) message content
    this.format = options.format || {};

    // "{$keyName}" => "variableValue"
    this.formatWCNGText = this.format.wcngText || '<{$displayUsername}> {$text}';

    // "{$keyName}" => "variableValue"
    // withMentions: text with appropriate mentions reformatted
    this.formatDiscord = this.format.discord || '**<{$author}>** {$withMentions}';
  }

  connect() {
    logger.debug('Connecting to WCNG and Discord');
    this.discord.login(this.discordToken);

    this.wcngClient = new wcngClient(this.wcng);
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
      logger.info('Received message event from ' + name + ': ' + message);
      this.sendToDiscord(name, message);
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
      this.sendToWCNG(message);
    });

    if (logger.level === 'debug') {
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
    return this.ignoreUsers.wcng.some(i => i.toLowerCase() === user.toLowerCase());
  }

  ignoredDiscordUser(discordUser) {
    const ignoredName = this.ignoreUsers.discord.some(
      i => i.toLowerCase() === discordUser.username.toLowerCase()
    );
    const ignoredId = this.ignoreUsers.discordIds.some(i => i === discordUser.id);
    return ignoredName || ignoredId;
  }

  static substitutePattern(message, patternMapping) {
    return message.replace(patternMatch, (match, varName) => patternMapping[varName] || match);
  }

  sendToWCNG(message) {
    const { author } = message;
    // Ignore messages sent by the bot itself:
    if (author.id === this.discord.user.id) return;

    // Do not send to wcng if this user is on the ignore list.
    if (this.ignoredDiscordUser(author)) {
      return;
    }

    const channelName = `#${message.channel.name}`;

    {
      const fromGuild = message.guild;
      const nickname = Bot.getDiscordNicknameOnServer(author, fromGuild);
      let text = this.parseText(message);
      let displayUsername = nickname;

      const patternMap = {
        author: nickname,
        nickname,
        displayUsername,
        text,
        discordChannel: channelName
      };

      if (text !== '') {
        // Convert formatting
        text = formatFromDiscordToWCNG(text);
        patternMap.text = text;

        text = Bot.substitutePattern(this.formatWCNGText, patternMap);
        logger.debug('Sending message to WCNG', text);
        this.wcngClient.sendMsg(text);
      }
    }
  }

  findDiscordChannel() {
    // #channel -> channel before retrieving and select only text channels:
    let discordChannel = null;

    if (this.discord.channels.cache.has(this.discordChannel)) {
      discordChannel = this.discord.channels.cache.get(this.discordChannel);
    } else if (this.discordChannel.startsWith('#')) {
      discordChannel = this.discord.channels.cache
        .filter(c => c.type === 'text')
        .find(c => c.name === this.discordChannel.slice(1));
    }

    if (!discordChannel) {
      logger.info(
        'Tried to send a message to a channel the bot isn\'t in: ',
        discordChannelName
      );
      return null;
    }
    return discordChannel;
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
    const discordChannel = this.findDiscordChannel();
    if (!discordChannel) return;

    // Do not send to Discord if this user is on the ignore list.
    if (this.ignoredWCNGUser(author)) {
      return;
    }

    // Convert text formatting
    const withFormat = formatFromWCNGToDiscord(text);

    const patternMap = {
      author,
      nickname: author,
      displayUsername: author,
      text: withFormat,
      discordChannel: `#${discordChannel.name}`,
    };

    const { guild } = discordChannel;
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

    patternMap.withMentions = withMentions;

    // Add bold formatting:
    // Use custom formatting from config / default formatting with bold author
    const withAuthor = Bot.substitutePattern(this.formatDiscord, patternMap);
    logger.debug('Sending message to Discord', withAuthor, '->', `#${discordChannel.name}`);
    discordChannel.send(withAuthor);
  }
}

export default Bot;
