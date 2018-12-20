var protocol = require('hypercore-protocol')
var readify = require('./ready')
var inherits = require('inherits')
var events = require('events')
var debug = require('debug')('multifeed/mux')
var hypercore = require('hypercore')
var xtend = require('xtend')

// constants
var MULTIFEED = 'MULTIFEED'
var PROTOCOL_VERSION = '2.0.0'
// extensions
var REQUEST_MANIFEST = 'REQUEST_MANIFEST'
var MANIFEST = 'MANIFEST'
var REQUEST_FEED_SIGNATURE = 'REQUEST_FEED_SIGNATURE'
var FEED_SIGNATURE = 'FEED_SIGNATURE'
var REQUEST_FEEDS = 'REQUEST_FEEDS'


var SupportedExtensions = [
  //REQUEST_MANIFEST,
  MANIFEST,
  //REQUEST_FEED_SIGNATURE,
  //FEED_SIGNATURE,
  REQUEST_FEEDS
]

function Multiplexer (key, opts) {
  if (!(this instanceof Multiplexer)) return new Multiplexer(key, opts)
  var self = this
  self._opts = opts = opts || {}
  self.extensions = opts.extensions = SupportedExtensions || opts.extensions

  // initialize
  self._localHave = null
  self._localWant = null
  self._remoteHas = null
  self._remoteWants = null

  var stream = this.stream = protocol(Object.assign(opts,{
    userData: Buffer.from(JSON.stringify({
      client: MULTIFEED,
      version: PROTOCOL_VERSION,
      extensions: self.extensions
    }))
  }))

  var feed = this._feed = stream.feed(key)

  stream.on('handshake', function () {
    var header = JSON.parse(this.userData.toString('utf8'))
    debug('[REPLICATION] recv\'d header: ', JSON.stringify(header))
    if (!compatibleVersions(header.version, PROTOCOL_VERSION)) {
      debug('[REPLICATION] aborting; version mismatch (us='+PROTOCOL_VERSION+')')
      self.emit('error', new Error('protocol version mismatch! us='+PROTOCOL_VERSION + ' them=' + header.version))
      return
    }

    if (header.client != MULTIFEED) {
      debug('[REPLICATION] aborting; Client mismatch! expected ', MULTIFEED, 'but got', header.client)
      self.emit('error', new Error('Client mismatch! expected ' + MULTIFEED + ' but got ' + header.client))
      return
    }
    self.remoteClient = header
    self.emit('ready', header)
  })

  feed.on('extension', function (type, message) {
    debug('Extension:', type, message.toString('utf8'))
    switch(type) {
      case MANIFEST:
        var rm = JSON.parse(message.toString('utf8'))
        self._remoteHas = rm.keys
        self.emit('manifest', rm)
        break
      case REQUEST_FEEDS:
        self._remoteWants = JSON.parse(message.toString('utf8'))
        self._initRepl()
        break
    }
  })

  this._ready = readify(function (done) {
    self.on('ready', function(remote){
      debug('[REPLICATION] remote connected and ready')
      done(remote)
    })
  })
}

inherits(Multiplexer, events.EventEmitter)

Multiplexer.prototype.ready = function(cb) {
  this._ready(cb)
}

Multiplexer.prototype.haveFeeds = function (keys, opts) {
  var manifest = xtend(opts || {}, {
    keys: extractKeys(keys)
  })
  this._localHave = manifest.keys

  this._feed.extension(MANIFEST, Buffer.from(JSON.stringify(manifest)))
}

Multiplexer.prototype.wantFeeds = function (keys) {
  keys = extractKeys(keys)
  debug('[REPLICATION] Sending feeds request', keys)
  this._feed.extension(REQUEST_FEEDS, Buffer.from(JSON.stringify(keys)))
  this._localWant = keys
  this._initRepl()
}

// this method is expected to be called twice, and will trigger
// the 'replicate' event when both local and remote 'wants' are available.
// calculating a sorted common denominator between both wants and availablility which
// should result in two identical arrays being built on both ends.
Multiplexer.prototype._initRepl = function() {
  var self = this
  if(!this._localWant || !this._remoteWants) return
  // the 'have' arrays might be null, It means that a client might not want
  // to share their manifests, and we can respect that.
  var known = (this._localHave || []).concat(this._remoteHas || [])

  var keys = this._localWant.concat(this._remoteWants)
    .reduce(function(arr, key){
      // Append only known and unique keys
      if (known.indexOf(key) !== -1 && arr.indexOf(key) === -1) arr.push(key)
      return arr
    }, [])
    .sort()

  debug('[REPLICATION] _initRepl', keys.length, keys)
  this.emit('replicate',  keys, startFeedReplication)

  function startFeedReplication(feeds){
    if (!Array.isArray(feeds)) feeds = [feeds]
    feeds.forEach(function(feed) {
      feed.replicate(xtend({}, self._opts, {
        expectedFeeds: keys.length + 1,
        stream: self.stream
      }))
    })
  }
}

module.exports = Multiplexer
module.exports.SupportedExtensions = SupportedExtensions

// String, String -> Boolean
function compatibleVersions (v1, v2) {
  var major1 = v1.split('.')[0]
  var major2 = v2.split('.')[0]
  return parseInt(major1) === parseInt(major2)
}

function extractKeys (keys) {
  if (!Array.isArray(keys)) keys = [keys]
  return keys = keys.map(function(o) {
    if (typeof o === 'string') return o
    if (typeof o === 'object' && o.key) return o.key.toString('hex')
    if (o instanceof Buffer) return o.toString('utf8')
  })
    .reduce(function (a, o) {
      if (o) a.push(o)
      return a
    }, [])
}
