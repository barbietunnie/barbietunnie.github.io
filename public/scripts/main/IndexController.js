import ToastsView from './views/Toasts';
import ConverterView from './views/Converter';
import idb from 'idb';
import { SCHEMA, CURRENCIES_STORE, CURRENCIES_URL } from './constants'; 

function openDatabase() {
  // If the browser doesn't support service worker,
  // we don't care about having a database
  if (!navigator.serviceWorker) {
    return Promise.resolve();
  }
  
  return idb.open(SCHEMA, 1, function(upgradeDb) {
    var store = upgradeDb.createObjectStore(CURRENCIES_STORE, { keyPath: 'id' });
  });
}

export default function IndexController(container) {
  this._container = container;
  this._converterView = new ConverterView(this._container);
  this._toastsView = new ToastsView(this._container);
  this._lostConnectionToast = null;
  this._dbPromise = openDatabase();
  this._registerServiceWorker();

  var indexController = this;

  // this._showCachedCurrencies().then(function() {
  //   indexController._openSocket();
  // });
  this._showConverterPanel(this._container);
}

IndexController.prototype._registerServiceWorker = function() {
  if (!navigator.serviceWorker) return;

  var indexController = this;

  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    if (!navigator.serviceWorker.controller) {
      return;
    }

    if (reg.waiting) {
      indexController._updateReady(reg.waiting);
      return;
    }

    if (reg.installing) {
      indexController._trackInstalling(reg.installing);
      return;
    }

    reg.addEventListener('updatefound', function() {
      indexController._trackInstalling(reg.installing);
    });
  });

  // Ensure refresh is only called once.
  // This works around a bug in "force update on reload".
  var refreshing;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (refreshing) return;
    window.location.reload();
    refreshing = true;
  });
};

// Load currencies from the database if available,
// otherwise, fetch from the network and save to the database
// for subsequent retrieval
IndexController.prototype._showConverterPanel = function(container) {
  const indexController = this;
  
  this._dbPromise.then(function(db) {
    // if we're already showing posts, eg shift-refresh
    // or the very first load, there's no point fetching
    // posts from IDB
    if (!db || indexController._converterView.showingCurrencies()) return;

    var store = db.transaction(CURRENCIES_STORE).objectStore(CURRENCIES_STORE);
    return store.getAll();
  }).then(function(currencies) {
    if(currencies && currencies.length > 0) {
      console.log(`${currencies.length} items found in the database`);

      indexController._converterView.addCurrencies(currencies);
      return;
    }

    // No currencies found in the database, load from the network
    console.log('No currencies found in the database. Downloading from the network...');
    fetch(CURRENCIES_URL).then(function(response) {
      return response.json();
    }).then(function(data){
        if(!data)
            return;

        const jsonData = data.results;
        
        // Add the currencies fetched into the database
        indexController._dbPromise.then(function(db) {
          if (!db) return;

          var tx = db.transaction(CURRENCIES_STORE, 'readwrite');
          var store = tx.objectStore(CURRENCIES_STORE);
          Object.keys(jsonData).forEach(symbol => {
            // console.log(symbol, '->', jsonData[symbol]);
            store.put(jsonData[symbol]);
          });
          
          store.getAll().then(function(currencies) {
            console.log(`${currencies.length} items found in the database`);

            indexController._converterView.addCurrencies(currencies);
          });
      });
    });
  });

  indexController._converterView.displayConverter();
}

IndexController.prototype._trackInstalling = function(worker) {
  var indexController = this;
  worker.addEventListener('statechange', function() {
    if (worker.state == 'installed') {
      indexController._updateReady(worker);
    }
  });
};

IndexController.prototype._updateReady = function(worker) {
  var toast = this._toastsView.show("New version available", {
    buttons: ['refresh', 'dismiss']
  });

  toast.answer.then(function(answer) {
    if (answer != 'refresh') return;
    worker.postMessage({action: 'skipWaiting'});
  });
};

IndexController.prototype.loadCurrencies = function() {

}

// open a connection to the server for live updates
// IndexController.prototype._openSocket = function() {
//   var indexController = this;
//   var latestPostDate = this._postsView.getLatestPostDate();

//   // create a url pointing to /updates with the ws protocol
//   var socketUrl = new URL('/updates', window.location);
//   socketUrl.protocol = 'ws';

//   if (latestPostDate) {
//     socketUrl.search = 'since=' + latestPostDate.valueOf();
//   }

//   // this is a little hack for the settings page's tests,
//   // it isn't needed for Wittr
//   socketUrl.search += '&' + location.search.slice(1);

//   var ws = new WebSocket(socketUrl.href);

//   // add listeners
//   ws.addEventListener('open', function() {
//     if (indexController._lostConnectionToast) {
//       indexController._lostConnectionToast.hide();
//     }
//   });

//   ws.addEventListener('message', function(event) {
//     requestAnimationFrame(function() {
//       indexController._onSocketMessage(event.data);
//     });
//   });

//   ws.addEventListener('close', function() {
//     // tell the user
//     if (!indexController._lostConnectionToast) {
//       indexController._lostConnectionToast = indexController._toastsView.show("Unable to connect. Retrying…");
//     }

//     // try and reconnect in 5 seconds
//     setTimeout(function() {
//       indexController._openSocket();
//     }, 5000);
//   });
// };

// IndexController.prototype._cleanImageCache = function() {
//   return this._dbPromise.then(function(db) {
//     if (!db) return;

//     var imagesNeeded = [];

//     var tx = db.transaction('wittrs');
//     return tx.objectStore('wittrs').getAll().then(function(messages) {
//       messages.forEach(function(message) {
//         if (message.photo) {
//           imagesNeeded.push(message.photo);
//         }
//         imagesNeeded.push(message.avatar);
//       });

//       return caches.open('wittr-content-imgs');
//     }).then(function(cache) {
//       return cache.keys().then(function(requests) {
//         requests.forEach(function(request) {
//           var url = new URL(request.url);
//           if (!imagesNeeded.includes(url.pathname)) cache.delete(request);
//         });
//       });
//     });
//   });
// };

// called when the web socket sends message data
// IndexController.prototype._onSocketMessage = function(data) {
//   var messages = JSON.parse(data);

//   this._dbPromise.then(function(db) {
//     if (!db) return;

//     var tx = db.transaction('wittrs', 'readwrite');
//     var store = tx.objectStore('wittrs');
//     messages.forEach(function(message) {
//       store.put(message);
//     });

//     // limit store to 30 items
//     store.index('by-date').openCursor(null, "prev").then(function(cursor) {
//       return cursor.advance(30);
//     }).then(function deleteRest(cursor) {
//       if (!cursor) return;
//       cursor.delete();
//       return cursor.continue().then(deleteRest);
//     });
//   });

//   this._postsView.addPosts(messages);
// };