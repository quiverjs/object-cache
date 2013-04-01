
var moment = require('moment')
var param = require('quiver-param')

var defaultMeasureSize = function(object) {
  if(object.length) return object.length
  return 1
}

var defaultOptions = param.defineParam()
  .optional('expiry', 300)
  .optional('memoryLimit', 1024)
  .optional('measureSize', defaultMeasureSize)

var createObjectCache = function(options) {
  options = defaultOptions.parseArgs(options)

  var expiry = options.expiry
  var memoryLimit = options.memoryLimit
  var measureSize = options.measureSize

  var cacheMap = { }
  var totalMemory = 0
  var entryCount = 0

  var cacheListHead = null
  var cacheListTail = null

  var assertIsHead = function(cacheEntry) {
    if(cacheEntry !== cacheListHead) throw new Error(
      'critical bug: inconsistent internal state')
  }

  var assertIsTail = function(cacheEntry) {
    if(cacheEntry !== cacheListTail) throw new Error(
      'critical bug: inconsistent internal state')
  }

  var printCacheList = function() {
    if(!cacheListHead) return console.log('cache list is now empty')
    var cacheList = []
    var currentEntry = cacheListHead
    while(currentEntry) {
      cacheList.push(currentEntry.id)
      currentEntry = currentEntry.next
    }
    console.log('current cache list order:', cacheList)
  }

  var cleaning = false
  var cleanCache = function() {
    // console.log('total memory is now', totalMemory)
    if(cleaning || totalMemory < memoryLimit) return

    // console.log('memory limit exceeded, cleaning cache')
    cleaning = true
    process.nextTick(function() {
      while(entryCount > 0 && totalMemory > memoryLimit) {
        removeCache(cacheListTail)
      }

      cleaning = false
      // printCacheList()
    })
  }

  var removeCache = function(cacheEntry) {
    // console.log('removing cache entry', cacheEntry.id)

    totalMemory -= cacheEntry.memorySize
    entryCount--

    delete cacheMap[cacheEntry.id]
    if(entryCount == 0) {
      cacheListHead = null
      cacheListTail = null
      return
    }

    if(cacheEntry.prev) {
      cacheEntry.prev.next = cacheEntry.next
    } else {
      assertIsHead(cacheEntry)
      cacheListHead = cacheEntry.next
    }

    if(cacheEntry.next) {
      cacheEntry.next.prev = cacheEntry.prev
    } else {
      assertIsTail(cacheEntry)
      cacheListTail = cacheEntry.prev
    }
    // printCacheList()
  }

  var bumpCache = function(cacheEntry) {
    if(!cacheEntry.prev) {
      assertIsHead(cacheEntry)
      return
    }

    cacheEntry.prev.next = cacheEntry.next

    if(cacheEntry.next) {
      cacheEntry.next.prev = cacheEntry.prev
    } else {
      assertIsTail(cacheEntry)
      cacheListTail = cacheEntry.prev
    }

    cacheEntry.prev = null
    cacheEntry.next = cacheListHead

    cacheListHead.prev = cacheEntry
    cacheListHead = cacheEntry

    // printCacheList()
  }

  var set = function(id, value, memorySize) {
    if(!value) return

    if(!memorySize) memorySize = measureSize(value)

    if(memorySize > memoryLimit) return

    var previousCache = cacheMap[id]
    if(previousCache) removeCache(previousCache)

    var cacheEntry = {
      id: id,
      value: value,
      memorySize: memorySize,
      creationTime:  moment(),
      prev: null,
      next: cacheListHead
    }

    if(entryCount == 0) {
      cacheListHead = cacheEntry
      cacheListTail = cacheEntry
    } else {
      cacheListHead.prev = cacheEntry
      cacheListHead = cacheEntry
    }

    cacheMap[id] = cacheEntry

    totalMemory += memorySize
    entryCount++

    // printCacheList()
    cleanCache()
  }

  var get = function(id) {
    var cacheEntry = cacheMap[id]

    if(!cacheEntry) return null

    if(moment().diff(cacheEntry.creationTime, 'seconds') > expiry) {
      // console.log('cache', cacheEntry.id, 'has expired')
      removeCache(cacheEntry)
      return null
    } else {
      bumpCache(cacheEntry)
      return cacheEntry.value
    }
  }

  var self = { 
    set: set,
    get: get
  }

  return self
}

var createCachedLoader = function(cache, loader) {
  var pendingCallbacks = { }

  var invokeCallbacks = function(id, err, result) {
    pendingCallbacks[id].forEach(function(callback) {
      process.nextTick(function() {
        callback(err, result)
      })
    })
    delete pendingCallbacks[id]
  }

  return function(id, callback) {
    var cachedValue = cache.get(id)
    if(cachedValue) {
      process.nextTick(function() {
        callback(null, cachedValue)
      })
      return
    }

    if(pendingCallbacks[id]) {
      pendingCallbacks[id].push(callback)
    } else {
      pendingCallbacks[id] = [callback]

      loader(id, function(err, value) {
        if(err) return invokeCallbacks(id, err)

        cache.set(id, value)
        invokeCallbacks(id, null, value)
      })
    }
  }
}

module.exports = {
  createObjectCache: createObjectCache,
  createCachedLoader: createCachedLoader
}