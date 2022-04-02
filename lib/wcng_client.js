import { EventEmitter } from 'events';
import tls from 'tls';
import net from 'net';
import crypto from 'crypto';
import hash from './hash';

class wcngClient extends EventEmitter {
  constructor(options) {
    super(); //EventEmitter constructor

    let ctx = this;
    this.options = options;
    
    this.defines = {
      protocolVersion: 5,
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
      clients: [],
      authTok: ""
    };

    this.isConnected = false,
    this.useSSL = false;

    this.net = new net.Socket();
    this.net.connect(this.options.port, this.options.host);

    this.net.on('connect', function() {
      ctx._resetConnection();
    });

    this.net.on('data', function(data) {
      ctx._onData(data);
    });

    this.net.on('close', function() {
      ctx._resetConnection();
      ctx._reconnectSocket();
    });
  }

  disconnect() {
    //not used anyway. why would i bother
  }

  sendMsg(string) {
    this._write(this._msgChatMsgBuild(string));
  }

  _disconnect() {
    //!debug
    //send disconnect msg
    //close socket after msg send
  }

  _write(data) {
    if(this.useSSL) {
      this.tls.write(data);
    } else {
      this.net.write(data);
    }
  }

  _reconnectSocket() {
    let ctx = this;
    this.useSSL = false;
    this.isConnected = false;
    //dont ddos the server
    setTimeout(function() {
      ctx.net.connect(ctx.options.port, ctx.options.host);
    }, 1000);
  }

  _onData(data) {
    if(!this.isConnected)
    {
      let connect = data[0];

      if(
        (this.defines.connectCode.NoSSL == connect) ||
        (this.defines.connectCode.UseSSL == connect)
      ) {
        if(this.defines.connectCode.NoSSL == connect) {
          if(!this.options.forceEncryption) {
            this._write(this._msgConnectBuild());
            this.isConnected = true;
          }
        } else if(this.defines.connectCode.UseSSL == connect) {
          let ctx = this;

          this.useSSL = true;

          if(!this.tls) {
            this.tls = new tls.TLSSocket(this.net);
        
            this.tls.on('data', function(data) {
              ctx._onData(data);
            });
          }

          if(this.options.forceAuthentication) {
            this.tls.renegotiate({ requestCert: true }, function(err) {
              if(!err) {
                let cert = ctx.tls.getPeerCertificate();

                {
                  let now = new Date();
                  let valid_from = new Date(cert.valid_from);
                  let valid_to = new Date(cert.valid_to);

                  if((now >= valid_from) && (now <= valid_to)) {
                    if(0 == ctx.options.fingerprint.localeCompare(cert.fingerprint256)) {
                      ctx._write(ctx._msgConnectBuild());
                      ctx.isConnected = true;
                    }
                  }
                }
              }
            });
          } else {
            ctx._write(ctx._msgConnectBuild());
            ctx.isConnected = true;
          }
        }

        for(let dataI = 1; dataI < data.length;) {
          let cmd = data[dataI];
          dataI++;

          if(this.defines.cmdCode.AuthTok == cmd) {
            let ret = this._msgAuthTokParse(data.slice(dataI));
            if(null == ret) { break; }
            dataI += ret;
          } else {
            break;
          }
        }
      }
    }
    else
    {
      //!debug this implementation expects data to be received in one call. thats not guaranteed.
      //!debug c-style solution. Is there a more js-style way?
      for(let dataI = 0; dataI < data.length;) {
        let cmd = data[dataI];
        dataI++;

        if(this.defines.cmdCode.Connect == cmd) {
          this._write(this._msgConnectBuild());
        } else if(this.defines.cmdCode.Connected == cmd) {
          let ret = this._msgConnectedParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;

          this._resetConnection();
          this.connection.pingTimer = setInterval(this._sendPing.bind(this), 5000);

          this.emit('connected');
        } else if(this.defines.cmdCode.ClientConnect == cmd) {
          let ret = this._msgClientConnectParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;
        } else if(this.defines.cmdCode.ClientDisconnect == cmd) {
          let ret = this._msgClientDisconnectParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;
        } else if(this.defines.cmdCode.ClientRename == cmd) {
          let ret = this._msgClientRenameParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;
        } else if(this.defines.cmdCode.ChatMsg == cmd) {
          let ret = this._msgChatMsgParse(data.slice(dataI));
          if(null == ret[0]) { break; }

          this.emit('message', this._findName(ret[1]), ret[2]);

          dataI += ret[0];
        } else if(this.defines.cmdCode.Pong == cmd) {
          let ret = this._msgPongParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;
        } else if(this.defines.cmdCode.Time == cmd) {
          let ret = this._msgTimeParse(data.slice(dataI));
          if(null == ret) { break; }
          dataI += ret;
        } else {
          break;
        }
      }
    }
  }

  _findName(id) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let sameName = 0;
      this.connection.clients.forEach(element => { if(element.name == client.name) sameName++; });

      if(sameName > 1) {
        return (client.name + ' (' + client.id + ')');
      } else {
        return client.name;
      }
    } else {
      return "unknown";
    }
  }

  _findId(name) {
    let client = this.connection.clients.find(element => element.name == name);
    if(undefined != client) {
      return client.id;
    } else {
      return -1;
    }
  }

  _removeUser(id) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let index = this.connection.clients.indexOf(client);
      if(index >= 0) {
        this.connection.clients.splice(index, 1);
      }
    }
  }

  _renameUser(id, name) {
    let client = this.connection.clients.find(element => element.id == id);
    if(undefined != client) {
      let index = this.connection.clients.indexOf(client);
      if(index >= 0) {
        this.connection.clients[index].name = name;
      }
    }
  }

  _resetConnection() {
    if(null != this.connection.pingTimer) {
      clearInterval(this.connection.pingTimer);
    }
    
    this.connection = {
      protocolVersion: 0,
      id: 0,
      pingTimer: null,
      clients: [],
      authTok: ""
    };
  }

  _sendPing() {
    this._write(this._msgPingBuild());
  }

  _createAuthString() {
    if(this.options.password != "") {
      //generate a random 256 byte string
      //original client uses 224 random numbers + 32 bytes 'A'. i have no idea why.
      let salt = crypto.randomBytes(192).toString('base64');
      //append the auth token for hashing
      let hashInput = this.options.password.concat(
        salt, this.connection.authTok
      );

      {
        //hash with tiger/192. wtf?! lets add a layer of obscurity to our security?
        let tiger = new hash();
        var hashOutput = tiger.tigerStr(hashInput);
      }

      return[salt, hashOutput];
    } else {
      return ["", ""];
    }
  }

  _msgConnectBuild() {
    let buffer = new Uint8Array(1024);   //!debug overflow incoming. how to do that properly in js?!
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.Connect;
    bufferPos++;
    buffer[bufferPos] = this.defines.protocolVersion;
    bufferPos++
    {
      let string = this._encodeString(this.options.nickname);   //playername
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    {
      let string = this._encodeString(this.options.nickname);   //wcchatname
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    {
      let string = this._encodeString(this.defines.os);
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }
    buffer[bufferPos] = this.defines.clientVersion.major;
    bufferPos++;
    buffer[bufferPos] = this.defines.clientVersion.minor;
    bufferPos++;
    {
      let word = this._encodeWord(this.defines.clientVersion.patch);
      buffer.set(word, bufferPos);
      bufferPos += word.length;
    }
    {
      let auth = this._createAuthString();
      {
        let string = this._encodeString(auth[0]);
        buffer.set(string, bufferPos);
        bufferPos += string.length;
      }
      {
        let string = this._encodeString(auth[1]);
        buffer.set(string, bufferPos);
        bufferPos += string.length;
      }
    }

    return buffer.slice(0, bufferPos);
  }

  _msgConnectedParse(data) {
    let dataPos = 0;

    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      this.connection.protocolVersion = word;
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      this.connection.id = word;
    }

    return dataPos;
  }

  _msgClientConnectParse(data) {
    let dataPos = 0;
    let client = {
      id: 0,
      name: "unknown"
    }

    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      client.id = word;
    }
    {
      dataPos += 4;
      //client address with last byte set to FF?!
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      //conntime
    }
    {
      let string = this._decodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this._encodedStringLength(string);
      client.name = string;
    }
    {
      let string = this._decodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this._encodedStringLength(string);
      //realname
    }
    {
      dataPos += 1;
      //random zero?!
    }
    {
      let string = this._decodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this._encodedStringLength(string);
      //osname
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      //major
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      //minor
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      //patch
    }

    this.connection.clients.push(client);

    return dataPos;
  }

  _msgClientDisconnectParse(data) {
    let dataPos = 0;

    {
      var id = this._decodeWord(data.slice(dataPos));
      if(null == id) { return; }
      dataPos += this._encodedWordLength(id);
    }
    {
      dataPos += 1;
      //expected or unexpected disconnect. why would i care. hes gone now.
    }

    this._removeUser(id);

    return dataPos;
  }

  _msgClientRenameParse(data) {
    let dataPos = 0;

    {
      var id = this._decodeWord(data.slice(dataPos));
      if(null == id) { return; }
      dataPos += this._encodedWordLength(id);
    }
    {
      var name = this._decodeString(data.slice(dataPos));
      if(null == name) { return; }
      dataPos += this._encodedStringLength(name);
      //name
    }
    {
      let string = this._decodeString(data.slice(dataPos));
      if(null == string) { return; }
      dataPos += this._encodedStringLength(string);
      //wcname
    }

    this._renameUser(id, name);

    return dataPos;
  }

  _msgChatMsgBuild(text) {
    let buffer_size = 256;
    let buffer = new Uint8Array(buffer_size);
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.ChatMsg;
    bufferPos++;
    {
      let word = this._encodeWord(-1);   //!debug what does -1 mean here? message target id = everyone?
      buffer.set(word, bufferPos);
      bufferPos += word.length;
    }
    {
      let string = this._encodeString(text);
      if((string.length + bufferPos) > buffer_size) {
        string = string.slice(0, buffer_size - bufferPos);
        string[buffer_size - bufferPos - 1] = 0;
      }
      buffer.set(string, bufferPos);
      bufferPos += string.length;
    }

    return buffer.slice(0, bufferPos);
  }

  _msgChatMsgParse(data) {
    let dataPos = 0;

    {
      var id = this._decodeWord(data.slice(dataPos));
      if(null == id) { return [null, null, null]; }
      dataPos += this._encodedWordLength(id);
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return [null, null, null]; }
      dataPos += this._encodedWordLength(word);
      //!debug random 0. what is this supposed to be?
    }
    {
      var msg = this._decodeString(data.slice(dataPos));
      if(null == msg) { return [null, null, null]; }
      dataPos += this._encodedStringLength(msg);
    }

    return [dataPos, id, msg];
  }

  _msgPingBuild() {
    let buffer = new Uint8Array(11);
    let bufferPos = 0;

    buffer[bufferPos] = this.defines.cmdCode.Ping;
    bufferPos++;
    //we dont actually care for latency. just use dummy values
    {
      let high = this._encodeWord(0x00);
      let low = this._encodeWord(0x00);
      buffer.set(high, bufferPos);
      bufferPos += high.length;
      buffer.set(low, bufferPos);
      bufferPos += low.length;
    }

    return buffer.slice(0, bufferPos);
  }

  _msgPongParse(data) {
    let dataPos = 0;

    //the dummy values we send before -> dont care
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
    }
    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
    }

    return dataPos;
  }

  _msgTimeParse(data) {
    let dataPos = 0;

    {
      let word = this._decodeWord(data.slice(dataPos));
      if(null == word) { return; }
      dataPos += this._encodedWordLength(word);
      //seconds since linux epoch
    }

    return dataPos;
  }

  _msgAuthTokParse(data) {
    let dataPos = 0;

    {
      var msg = this._decodeString(data.slice(dataPos));
      if(null == msg) { return [null, null, null]; }
      dataPos += this._encodedStringLength(msg);
      this.connection.authTok = msg;
    }

    return dataPos;
  }

  //convert string into zero terminated Uint8Array
  _encodeString(string) {
    let encoder = new TextEncoder();
    let encoded = encoder.encode(string);
    let array = new Uint8Array(encoded.length + 1);

    array.set(encoded);
    array[encoded.length] = 0;

    return array;
  }

  _decodeString(data) {
    let index = data.indexOf(0);
    let decoder = new TextDecoder();
    if(index < 0) { return; }
    let str = decoder.decode(data.slice(0, index));
    return str;
  }

  _encodedStringLength(string) {
    return string.length + 1;
  }

  _encodeWord(word) {
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

  _decodeWord(data) {
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

  _encodedWordLength(word) {
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
