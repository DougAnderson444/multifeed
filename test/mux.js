var test = require('tape')
var hypercore = require('hypercore')
var ram = require('random-access-memory')
var multiplexer = require('../mux.js')
var pump = require('pump')
var through = require('through2')
var debug = require('debug')('multifeed/protodump')

test('Key exchange API', function(t){
  t.plan(6)
  var encryptionKey = Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef') // used to encrypt the connection

  var mux1 = multiplexer(encryptionKey)
  var mux2 = multiplexer(encryptionKey)

  mux1.ready(function(client){
    mux2.on('manifest', function(m, req) {
      t.ok(m.keys instanceof Array, 'Manifest contains an array of feed keys')
      t.deepEqual(m.keys, ['A', 'B', 'C'])
      req(['A','C','X'])
    })
    var countEv = 0

    // replicate event init missing:
    mux1.on('replicate', function(keys, repl) {
      t.deepEqual(keys, ['A','C'], 'List of filtered keys to initialize')
      t.equal(typeof repl, 'function')
      if (++countEv == 2) t.end()
    })
    mux2.on('replicate', function(keys, repl) {
      t.deepEqual(keys, ['A','C'], 'List of filtered keys to initialize')
      t.equal(typeof repl, 'function')
      if (++countEv == 2) t.end()
    })
    mux1.offerFeeds(['A', 'B', 'C'])
  })
  mux1.on('finalize', t.error)
  pump(mux1.stream,mux2.stream,mux1.stream)
})
