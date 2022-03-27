import SimpleMarkdown from 'simple-markdown';
import EmojiConvertor from 'emoji-js';

function mdNodeToPlain(node) {
  let { content } = node;
  if (Array.isArray(content)) content = content.map(mdNodeToPlain).join('');
  return content;
}

export function formatFromDiscordToWCNG(text) {
  //remove bold, italic, etc
  {
    const markdownAST = SimpleMarkdown.defaultInlineParse(text);
    text = markdownAST.map(mdNodeToPlain).join('');
  }

  //replace emojis with text representation
  {
    let emoji = new EmojiConvertor();
    emoji.colons_mode = true;
    text = emoji.replace_unified(text);
  }

  return text;
}

export function formatFromWCNGToDiscord(text) {
  //no fancy formatting in sauer chat (i hope)
  return text;
}
