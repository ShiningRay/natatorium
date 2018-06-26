import { EventEmitter } from "events";
import { Socket } from "dgram";
import dgram = require('dgram');
import crypto = require('crypto');
import os = require('os');
import util = require('util');
import nanoid = require('nanoid');

const nodeVersion = process.version.replace('v', '').split(/\./gi).map(function (t) {
  return parseInt(t, 10)
});

const procUuid = nanoid();
const hostName = os.hostname();

export interface DiscoverOptions {
  address?: string;
  port?: number;
  broadcast?: string;
  multicast?: string;
  multicastTTL?: number;
  unicast?: string | string[];
  key?: string;
  reuseAddr?: boolean;
  ignoreProcess?: boolean;
  ignoreInstance?: boolean;
}

export class Network extends EventEmitter {
  private socket: Socket;
  private address: string;
  private port: number;
  /**
   * broadcast address
   */
  private broadcast: string;
  /**
   * multicast address
   */
  private multicast?: string;
  private multicastTTL: number;
  private unicast: string[] = [];
  private key: string | null;
  private reuseAddr: boolean;
  private ignoreProcess: boolean;
  private ignoreInstance: boolean;
  public readonly instanceUuid: string;
  private processUuid: string;
  private destination: string[] = [];

  constructor(options: DiscoverOptions = {}) {
    super();
    this.address = options.address || '0.0.0.0';
    this.port = options.port || 23456;
    this.broadcast = options.broadcast || "255.255.255.255";
    this.multicast = options.multicast;
    this.multicastTTL = options.multicastTTL || 1;
    if (typeof options.unicast === 'string') {
      this.unicast = options.unicast.split(',');
    }
    this.key = options.key || null;
    this.reuseAddr = (options.reuseAddr === false) ? false : true;
    this.ignoreProcess = (options.ignoreProcess === false) ? false : true;
    this.ignoreInstance = (options.ignoreInstance === false) ? false : true;

    this.socket = dgram.createSocket({
      type: 'udp4',
      reuseAddr: this.reuseAddr
    });

    this.instanceUuid = nanoid();
    this.processUuid = procUuid;

    this.socket.on("message", (data, rinfo) => {
      this.decode(data, (err, obj) => {
        if (err) {
          //most decode errors are because we tried
          //to decrypt a packet for which we do not
          //have the key

          //the only other possibility is that the
          //message was split across packet boundaries
          //and that is not handled
          console.error(err)
          this.emit("error", err);
        } else if (obj.pid == procUuid && this.ignoreProcess && obj.iid !== this.instanceUuid) {
          return false;
        } else if (obj.iid == this.instanceUuid && this.ignoreInstance) {
          return false;
        } else if (obj.event && obj.data) {
          this.emit(obj.event, obj.data, obj, rinfo);
        } else {
          this.emit("message", obj)
        }
      });
    });

    this.on("error", (err) => {
      //TODO: Deal with this
      console.log("Network error: ", err.stack);
    });
  }

  /**
   * start the network
   * @param callback 
   */
  start(callback?: (err?: any) => any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.bind(this.port, this.address, () => {
        if (this.unicast && this.unicast.length > 0) {
          this.destination = this.unicast.slice(0, this.unicast.length);
        } else if (!this.multicast) {
          //Default to using broadcast if multicast address is not specified.
          this.socket.setBroadcast(true);
          //TODO: get the default broadcast address from os.networkInterfaces() (not currently returned)
          this.destination = [this.broadcast];
        } else {
          try {
            //addMembership can throw if there are no interfaces available
            this.socket.addMembership(this.multicast);
            this.socket.setMulticastTTL(this.multicastTTL);
          } catch (e) {
            this.emit('error', e);
            if (callback) {
              callback(e);
            }
            return reject(e);
          }

          this.destination = [this.multicast];
        }
        callback && callback();
        resolve();
      });
    });
  }

  stop(callback?: (err?: any) => any) {

    this.socket.close();

    callback && callback();
  }

  send(event: string, data?: any) {

    var obj = {
      event: event,
      pid: procUuid,
      iid: this.instanceUuid,
      hostName: hostName,
      data: null
    };

    if (data) {
      obj.data = data;
    } else {
      //TODO: splice the arguments array and remove the first element
      //setting data to the result array
    }

    this.encode(obj, (err: any, contents?: string) => {
      if (err || !contents) {
        return false;
      }
      console.log('sending ', contents)
      var msg = new Buffer(contents);

      for (const d of this.destination) {
        this.socket.send(
          msg, 0, msg.length, this.port, d
        );
      }
    });
  }

  encode(data: any, callback: (err: any, contents?: string) => any) {
    let tmp;

    try {
      tmp = (this.key) ?
        encrypt(JSON.stringify(data), this.key) :
        JSON.stringify(data);
    } catch (e) {
      return callback(e);
    }

    return callback(null, tmp);
  }

  decode(data: Buffer, callback: (err: any, obj?: any) => any) {
    let tmp;

    try {
      if (this.key) {
        tmp = JSON.parse(decrypt(data.toString(), this.key));
      } else {
        tmp = JSON.parse(data.toString());
      }
    } catch (e) {
      return callback(e, null);
    }

    return callback(null, tmp);
  }
}

function encrypt(str: string, key: string): string {
  var buf = '';
  var cipher = crypto.createCipher('aes256', key);

  buf += cipher.update(str, 'utf8', 'binary');
  buf += cipher.final('binary');

  return buf;
}

function decrypt(str: string, key: string) {
  var buf = '';
  var decipher = crypto.createDecipher('aes256', key);

  buf += decipher.update(str, 'binary', 'utf8');
  buf += decipher.final('utf8');

  return buf;
}

export class Discover extends EventEmitter {
  private broadcaster: Network;
  private localData: any = {};
  private timer?: NodeJS.Timer;
  static start(port: number, data?: any): Promise<Discover>;
  static start(options: DiscoverOptions, data?: any): Promise<Discover>;
  static async start(optionsOrPort: DiscoverOptions | number, data?: any): Promise<Discover> {
    let options: DiscoverOptions = {};
    if (typeof optionsOrPort === 'number') {
      options.port = optionsOrPort;
    } else {
      options = optionsOrPort;
    }
    let d = new Discover(options, data);
    d.start();
    return d;
  }

  constructor(options: DiscoverOptions = {}, myData?: any) {
    super();
    this.localData = myData || {};
    this.broadcaster = new Network(options);
    this.broadcaster.on("hello", this.evaluateHello.bind(this));
    this.localData.timestamp = Date.now();
  }

  start() {
    this.broadcaster.start((err) => {
      console.log(err)
    });
    this.timer = setInterval(() => this.broadcastHello(), 2000);
  }

  stop() {
    if (this.timer)
      clearInterval(this.timer);
  }

  async broadcastHello() {
    this.broadcaster.send("hello", this.localData);
  }
	/*
	 * When receiving hello messages we need things to happen in the following order:
	 * 	- make sure the node is in the node list
	 * 	- if hello is from new node, emit added
	 * 	- if hello is from new master and we are master, demote
	 * 	- if hello is from new master emit master
	 *
	 * need to be careful not to over-write the old node object before we have information
	 * about the old instance to determine if node was previously a master.
	 */
  evaluateHello(data: any, obj: any, rinfo: dgram.RemoteInfo) {
    console.log(data);
    console.log(obj);
    //prevent processing hello message from self
    if (obj.iid === this.broadcaster.instanceUuid) {
      return;
    }

    data.lastSeen = Date.now();
    data.address = rinfo.address;
    data.hostName = obj.hostName;
    data.port = rinfo.port;
    data.id = obj.iid;

    this.emit("helloReceived", data);
  }
}

if (require.main === module) {
  var d = new Discover();
  d.start();
}