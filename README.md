# multi-hypercore

> multi-writer hypercore

Small module that manages multiple hypercores: feeds you create locally are
writeable, others' are readonly. Replicating with another multi-hypercore peers
exchanges the content of all of the hypercores.

## Usage

```js
var multicore = require('multi-hypercore')
var hypercore = require('hypercore')
var ram = require('random-access-memory')

var multi = multicore(hypercore, './db', { valueEncoding: 'json' })

// a multi-hypercore starts off empty
console.log(multi.feeds().length)             // => 0

// create as many writeable feeds as you want; returns hypercores
multi.writer(function (err, w) {
  console.log(w.key, w.writeable, w.readable)   // => Buffer <0x..> true true
  console.log(multi.feeds().length)             // => 1

  // write data to any writeable feed, just like with hypercore
  w.append('foo', function () {
    var m2 = multicore(ram, { valueEncoding: 'json' })
    m2.writer(function (err, w2) {
      w2.append('bar', function () {
        replicate(multi, m2, function () {
          console.log(m2.feeds().length)        // => 2
          m2.feeds()[1].get(0, function (_, data) {
            console.log(data)                   // => foo
          })
          multi.feeds()[1].get(0, function (_, data) {
            console.log(data)                   // => bar
          })
        })
      })
    })
  })
})

function replicate (a, b, cb) {
  var r = a.replicate()
  r.pipe(b.replicate()).pipe(r)
    .once('end', cb)
    .once('error', cb)
}
```

## API

```js
var multicore = require('multi-hypercore')
```

### var multi = multicore(hypercore, storage[, opts])

Pass in the a hypercore module (`require('hypercore')`), a
[random-access-storage](https://github.com/random-access-storage/random-access-storage)
backend, and options. Included `opts` are passed into new hypercores created,
and are the same as
[hypercore](https://github.com/mafintosh/hypercore#var-feed--hypercorestorage-key-options)'s.

### multi.writer(cb)

Create a new local writeable feed. Returns a hypercore instance in the callback
`cb`.

### var feeds = multi.feeds()

An array of all hypercores in the multi-hypercore. Check a feed's `key` to
find the one you want, or check its `writable` / `readable` properties.

### var feed = multi.feed(key)

Fetch a feed by its key `key` (a `Buffer`).

### var stream = multi.replicate([opts])

Create a duplex stream for replication.

Works just like hypercore, except *all* local hypercores are exchanged between
replication endpoints.

### multi.on('feed', function (feed, idx) { ... })

Emitted whenever a new feed is added, whether locally or remotely.

## Install

With [npm](https://npmjs.org/) installed, run

```
$ npm install multi-hypercore
```

## Hacks

1. `hypercore-protocol` requires the first feed exchanged to be common between
   replicating peers. This prevents two strangers from exchanging sets of
   hypercores. A "fake" hypercore with a hardcoded public key is included in the
   code to bootstrap the replication process. I discarded the private key, but
   even if I didn't, it doesn't let me do anything nefarious. You could patch
   this with your own key of choice.
2. `hypercore-protocol` requires all feed keys be known upfront: only discovery
   keys are exchanged (`discoveryKey = hash(key)`), so this module wraps the
   hypercore replication duplex stream in a secondary duplex stream that
   exchanges feed public keys upfront before moving on to the hypercore
   replication mechanism.

## License

ISC
