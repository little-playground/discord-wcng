import { EventEmitter } from 'events';
import tls from 'tls';
import net from 'net';
import fs from 'fs';

class wcngClient extends EventEmitter {
  constructor(options) {
    super(); //EventEmitter constructor

    let ctx = this;
    this.options = options;

    this.defines = {
      protocolVersion: 5,
      playerName: "sGlobal",  //!debug move to options
      wcChatName: "sGlobal",  //!debug move to options
      os: "linux64",  //make something up. why is this in the protocol anyway?
      clientVersion: {  //not even a sauer client :P
        major: 0,
        minor: 0,
        patch: 0
      },
      cmdCode: {
        Connect: 0,
        Connected: 1,
        Disconnect: 2,
        InvalidProtocol: 3,
        InvalidPassword: 4,
        ClientConnect: 5,
        ClientDisconnect: 6,
        ClientRename: 7,
        ChatMsg: 8,
        ServerInfo: 9,
        Ping: 10,
        Pong: 11,
        Time: 12,
        AuthTok: 13,
        Msg: 14,
      },
      connectCode: {
        NoSSL: 0,
        UseSSL: 1,
        DiscServerFull: 2,
        DiscIPBanned: 3,
      }
    };

    this.connection = {
      protocolVersion: 0,
      id: 0,
      pingTimer: null,
      clients: []
    };

    this.isConnected = false,
    this.useSSL = false;

    this.net = new net.Socket();
    this.net.connect(6664, this.options.socket.server);

    this.net.on('connect', function() {
      console.log("connect");
      ctx.privResetConnection();
    });

    this.net.on('data', function(data) {
      ctx.privOnData(data);
    });
    
    this.net.on('error', function(e) {
      console.log("error " + e);
    });

    this.net.on('close', function() {
      console.log("close");
      ctx.privResetConnection();
      ctx.privReconnectSocket();
    });
  }

  disconnect() {
    //not used anyway. why would i bother
  }

  sendMsg(string) {
    this.privWrite(this.privMsgChatMsgBuild(string));
  }

  privDisconnect() {
    //!debug
    //send disconnect msg
    //close socket after msg send
  }

  privWrite(data) {
    if(this.useSSL) {
      this.tls.write(data);
    } else {
      this.net.write(data);
    }
  }

  privReconnectSocket() {
    let ctx = this;
    this.useSSL = false;
    this.isConnected = false;
    //dont ddos the server
    setTimeout(function() {
      ctx.net.connect(6664, ctx.options.socket.server);
    }, 1000);
  }

  privOnData(data) {
    console.log("net data(" + data.length + "): " + data.toString('hex'));

    if(!this.isConnected)
    {
      let connect = data[0];

      if(this.defines.connectCode.NoSSL == connect) {
        this.privWrite(this.privMsgConnectBuild());
        this.isConnected = true;
      } else if(this.defines.connectCode.UseSSL == connect) {
        let ctx = this;

        this.tls = new tls.TLSSocket(this.net, { rejectUnauthorized: false });
        this.useSSL = true;

        this.tls.on('connect', function() {
          console.log("tls-connect");
        });
    
        this.tls.on('data', function(data) {
          ctx.privOnData(data);
        });
        
        this.tls.on('error', function(e) {
          console.log("tls-error " + e);
        });
    
        this.tls.on('close', function() {
          console.log("tls-close");
        });

        this.privWrite(this.privMsgConnectBuild());
        this.isConnected = true;
      }
    }
    else
    {
      //!debug this implementation expects data to be received in one call. thats not guaranteed.
      //!debug c-style solution. Is there a more js-style way?
      for(let dataI = 0; dataI < data.length;) {
        let cmd = data[dataI];
        dataI++;

        console.log("command code: " + cmd);

        if(this.defines.cmdCode.Connect == cmd)
        {
          this.privWrite(this.privMsgConnectBuild());
        }
        else if(this.defines.cmdCode.Connected == cmd)
        {
          let ret = this.privMsgConnectedParse(data.slice(dataI))
          if(null == ret) {
            break;
          }
          dataI += ret;

          this.privResetConnection();
          this.connection.pingTimer = setInterval(this.privSendPing.bind(this), 5000);

          this.emit('connected');
        }
        else if(this.defines.cmdCode.ClientConnect == cmd)
        {
          let ret = this.privMsgClientConnectParse(data.slice(dataI));
          if(null == ret) {
            break;
          }
          dataI += ret;
        }
        else if(this.defines.cmdCode.ClientDisconnect == cmd)
        {
          let ret = this.privMsgClientDisconnectParse(data.slice(dataI));
          if(null == ret) {
            break;
          }
          dataI += ret;
        }
        else if(this.defines.cmdCode.ClientRename == cmd)
        {
          let ret = this.privMsgClientRenameParse(data.slice(dataI));
          if(null == ret) {
            break;
          }
          dataI += ret;
        }
        else if(this.defines.cmdCode.ChatMsg == cmd)
        {
          let ret = this.privMsgChatMsgParse(data.slice(dataI));
          if(null == ret[0]) {
            break;
          }

          console.log("chat message");

          this.emit('message', this.privFindName(ret[1]), ret[2]);

          dataI += ret[0];
        }
        else if(this.defines.cmdCode.Pong == cmd)
        {
          let ret = this.privMsgPongParse(data.slice(dataI));
          if(null == ret) {
            break;
          }
          dataI += ret;
        }
        else if(this.defines.cmdCode.Time == cmd)
        {
          let ret = this.privMsgTimeParse(data.slice(dataI))
          if(null == ret) {
            break;
          }
          dataI += ret;
        }
        else
        {
          console.log("invalid command code");
          break;
        }
      }
    }
  }

  privFindName(id) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let sameName = 0;
      this.connection.clients.forEach(element => { if(element.name == client.name) sameName++; });

      if(sameName > 1)
      {
        return (client.name + ' (' + client.id + ')');
      }
      else
      {
        return client.name;
      }
    }
    else {
      return "unknown";
    }
  }

  privFindId(name) {
    let client = this.connection.clients.find(element => element.name == name);
    if(undefined != client) {
      return client.id;
    }
    else {
      return -1;
    }
  }

  privRemoveUser(id) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let index = this.connection.clients.indexOf(client);
      if(index >= 0) {
        this.connection.clients.splice(index, 1);
      }
    }
  }

  privRenameUser(id, name) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let index = this.connection.clients.indexOf(client);
      if(index >= 0) {
        this.connection.clients[index].name = name;
      }
    }
  }

  privResetConnection() {
    if(null != this.connection.pingTimer) {
      clearInterval(this.connection.pingTimer);
    }
    
    this.connection = {
      protocolVersion: 0,
      id: 0,
      pingTimer: null,
      clients: []
    };
  }

  privSendPing() {
    this.privWrite(this.privMsgPingBuild());
  }

  privMsgConnectBuild() {
    let buffer = new Uint8Array(256);   //!debug overflow incoming. how to do that properly in js?!
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.Connect;
    bufferPos++;
    buffer[bufferPos] = this.defines.protocolVersion;
    bufferPos++
    {
      let string = this.privEncodeString(this.defines.playerName);
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    {
      let string = this.privEncodeString(this.defines.wcChatName);
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    {
      let string = this.privEncodeString(this.defines.os);
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    buffer[bufferPos] = this.defines.clientVersion.major;
    bufferPos++;
    buffer[bufferPos] = this.defines.clientVersion.minor;
    bufferPos++;
    {
      let word = this.privEncodeWord(this.defines.clientVersion.patch);
      buffer.set(word, bufferPos);
      bufferPos += word.length;
    }
    //!debug hash and salt if using authentication
    buffer[bufferPos] = 0;
    bufferPos++;
    buffer[bufferPos] = 0;
    bufferPos++;

    return buffer.slice(0, bufferPos);
  }

  privMsgConnectedParse(data) {
    let dataPos = 0;

    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      this.connection.protocolVersion = word;
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      this.connection.id = word;
    }

    return dataPos;
  }

  privMsgClientConnectParse(data) {
    let dataPos = 0;
    let client = {
      id: 0,
      name: "unknown"
    }

    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      client.id = word;
    }
    {
      dataPos += 4;
      //client address with last byte set to FF
      //why isnt this a encoded word but just 4 bytes?
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      //conntime
    }
    {
      let string = this.privDecodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this.privEncodedStringLength(string);
      client.name = string;
    }
    {
      let string = this.privDecodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this.privEncodedStringLength(string);
      //realname
    }
    {
      dataPos += 1;
      //random zero?!
    }
    {
      let string = this.privDecodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this.privEncodedStringLength(string);
      //osname
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      //major
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      //minor
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      //patch
    }

    this.connection.clients.push(client);

    return dataPos;
  }

  privMsgClientDisconnectParse(data) {
    let dataPos = 0;

    {
      var id = this.privDecodeWord(data.slice(dataPos));
      if(null == id) { return; }
      dataPos += this.privEncodedWordLength(id);
    }
    {
      dataPos += 1;
      //expected or unexpected disconnect. why would i care. hes gone now.
    }

    this.privRemoveUser(id);

    return dataPos;
  }

  privMsgClientRenameParse(data) {
    let dataPos = 0;

    {
      var id = this.privDecodeWord(data.slice(dataPos));
      if(null == id) { return; }
      dataPos += this.privEncodedWordLength(id);
    }
    {
      var name = this.privDecodeString(data.slice(dataPos));
      if(null == name) { return; }
      dataPos += this.privEncodedStringLength(name);
      //name
    }
    {
      let string = this.privDecodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this.privEncodedStringLength(string);
      //wcname
    }

    this.privRenameUser(id, name);

    return dataPos;
  }

  privMsgChatMsgBuild(text) {
    let buffer_size = 256;
    let buffer = new Uint8Array(buffer_size);
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.ChatMsg;
    bufferPos++;
    {
      let word = this.privEncodeWord(-1);   //!debug what does -1 mean here? message target id = everyone?
      buffer.set(word, bufferPos);
      bufferPos += word.length;
    }
    {
      let string = this.privEncodeString(text);
      if((string.length + bufferPos) > buffer_size) {
        string = string.slice(0, buffer_size - bufferPos);
        string[buffer_size - bufferPos - 1] = 0;
      }
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }

    return buffer.slice(0, bufferPos);
  }

  privMsgChatMsgParse(data) {
    let dataPos = 0;

    {
      var id = this.privDecodeWord(data.slice(dataPos));
      if(null == id) { return [null, null, null]; }
      dataPos += this.privEncodedWordLength(id);
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return [null, null, null]; }
      dataPos += this.privEncodedWordLength(word);
      //!debug random 0. what is this supposed to be?
    }
    {
      var msg = this.privDecodeString(data.slice(dataPos));
      if(null == msg) { return [null, null, null]; }
      dataPos += this.privEncodedStringLength(msg);
    }

    return [dataPos, id, msg];
  }

  privMsgPingBuild() {
    let buffer = new Uint8Array(11);
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.Ping;
    bufferPos++;
    //!debug salted ping? dont get it. try dummy for now
    {
      let high = this.privEncodeWord(0x00);
      let low = this.privEncodeWord(0x00);
      buffer.set(high, bufferPos);
      bufferPos += high.length;
      buffer.set(low, bufferPos);
      bufferPos += low.length;
    }

    return buffer.slice(0, bufferPos);
  }

  privMsgPongParse(data) {
    let dataPos = 0;

    //!debug salted ping? dont get it
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
    }
    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
    }

    return dataPos;
  }

  privMsgTimeParse(data) {
    let dataPos = 0;

    {
      let word = this.privDecodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this.privEncodedWordLength(word);
      //seconds since linux epoch
      //!debug i have no use for this. maybe used in authentication?
    }

    return dataPos;
  }

  //convert string into zero terminated Uint8Array
  privEncodeString(string) {
    let encoder = new TextEncoder();
    let encoded = encoder.encode(string);
    let array = new Uint8Array(encoded.length + 1);

    array.set(encoded);
    array[encoded.length] = 0;

    return array;
  }

  privDecodeString(data) {
    let index = data.indexOf(0);
    let decoder = new TextDecoder();
    if(index < 0) { return; }
    let str = decoder.decode(data.slice(0, index));
    return str;
  }

  privEncodedStringLength(string) {
    return string.length + 1;
  }

  privEncodeWord(word) {
    let array = new Uint8Array(5);
    if ((word <= 0xFF) && (word != 0x80) && (word != 0x81)) {
      array[0] = word;
      return array.slice(0, 1);
    } else if (word <= 0xFFFF) {
      array[0] = 0x80;
      array[1] = word & 0xFF;
      array[2] = (word >> 8) & 0xFF;
      return array.slice(0, 3);
    } else {
      array[0] = 0x80;
      array[1] = word & 0xFF;
      array[2] = (word >> 8) & 0xFF;
      array[3] = (word >> 16) & 0xFF;
      array[4] = (word >> 24) & 0xFF;
      return array.slice(0, 5);
    }
  }

  privDecodeWord(data) {
    let val = 0;

    if (
      (1 > data.length) ||
      ((0x80 == data[0]) && (3 > data.length)) ||
      ((0x81 == data[0]) && (5 > data.length))
    ) {
      return null;
    }

    if (0x80 == data[0]) {
      val += data[1];
      val += (data[2] << 8);
    } else if (0x81 == data[0]) {
      val += data[1];
      val += (data[2] << 8);
      val += (data[3] << 16);
      val += (data[4] << 24);
    } else {
      val += data[0];
    }

    return val;
  }

  privEncodedWordLength(word) {
    if((0xFF >= word) && (0x80 != word) && (0x81 != word)) {
      return 1;
    } else if (0xFFFF >= word) {
      return 3;
    } else {
      return 5;
    }
  }
}

export default wcngClient;
