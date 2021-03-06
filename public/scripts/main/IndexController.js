'use strict';

import ToastsView from './views/Toasts';
import ConverterView from './views/Converter';
import idb from 'idb';
import { SCHEMA, CURRENCIES_STORE, CURRENCIES_URL, 
          RATES_STORE, CONVERSION_URL, KEYUP_DELAY } from './constants'; 
import debounce from './../utils/debounce';

function openDatabase() {
  // If the browser doesn't support service worker,
  // we don't care about having a database
  if (!navigator.serviceWorker) {
    return Promise.resolve();
  }
  
  return idb.open(SCHEMA, 2, function(upgradeDb) {
    switch(upgradeDb.oldVersion) {
      case 0:
        upgradeDb.createObjectStore(CURRENCIES_STORE, { keyPath: 'id' });
      case 1:
        upgradeDb.createObjectStore(RATES_STORE, { keyPath: 'id' });
    }
  });
}

module.exports = class IndexController {
  constructor(container) {
    this._container = container;
    this._converterView = new ConverterView(this._container);
    this._toastsView = new ToastsView(this._container);
    this._lostConnectionToast = null;
    this._dbPromise = openDatabase();
    this._registerServiceWorker();
  
    const indexController = this;
  
    // this._showCachedCurrencies().then(function() {
    //   indexController._openSocket();
    // });
    this._showConverterPanel(this._container);
  }

  _registerServiceWorker() {
    if (!navigator.serviceWorker) return;
  
    const indexController = this;
  
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
    let refreshing;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (refreshing) return;
      window.location.reload();
      refreshing = true;
    });
  }

  // Load currencies from the database if available,
  // otherwise, fetch from the network and save to the database
  // for subsequent retrieval
  _showConverterPanel(container) {
    const indexController = this;
    
    this._dbPromise.then(function(db) {
      // if we're already showing posts, eg shift-refresh
      // or the very first load, there's no point fetching
      // posts from IDB
      if (!db || indexController._converterView.showingCurrencies()) return;

      const store = db.transaction(CURRENCIES_STORE).objectStore(CURRENCIES_STORE);
      return store.getAll();
    }).then(function(currencies) {
      if(currencies && currencies.length > 0) {
        console.log(`${currencies.length} items found in the database`);

        indexController._converterView.addCurrencies(currencies);
        indexController._registerEventOnInputFields();
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

            const tx = db.transaction(CURRENCIES_STORE, 'readwrite');
            const store = tx.objectStore(CURRENCIES_STORE);
            Object.keys(jsonData).forEach(symbol => {
              // console.log(symbol, '->', jsonData[symbol]);
              store.put(jsonData[symbol]);
            });
            
            store.getAll().then(function(currencies) {
              console.log(`${currencies.length} items found in the database`);

              indexController._converterView.addCurrencies(currencies);
              indexController._registerEventOnInputFields();
            });
        });
      });
    });
  }

  _trackInstalling(worker) {
    const indexController = this;
    worker.addEventListener('statechange', function() {
      if (worker.state == 'installed') {
        indexController._updateReady(worker);
      }
    });
  }

  _updateReady(worker) {
    const toast = this._toastsView.show("New version available", {
      buttons: ['refresh', 'dismiss']
    });
  
    toast.answer.then(function(answer) {
      if (answer != 'refresh') return;
      worker.postMessage({action: 'skipWaiting'});
    });
  }

  _registerEventOnInputFields() {
    const fromField = this._container.querySelector('#amt1');
    const toField = this._container.querySelector('#amt2');
    const fromCurr = this._container.querySelector('#fromCurrency');
    const toCurr = this._container.querySelector('#toCurrency');
  
    fromField.addEventListener("keyup", debounce((event) => {
        // console.log('Left: ', fromField.value);
        // If both fields are filled
        if(fromField.value && toField.value)
            // this.convert().then(function(val) {
            //   console.log(`Rate: ${val}`);
            // });
            this._convert(fromCurr, fromField, toCurr, toField);
    }, KEYUP_DELAY));
  
    toField.addEventListener("keyup", debounce((event) => {
        // console.log('Right: ', toField.value);
        if(fromField.value && toField.value)
            // this.convert().then(function(val) {
            //   console.log(`Rate: ${val}`);
            // });
            this._convert(toCurr, toField, fromCurr, fromField);
    }, KEYUP_DELAY));
  
    // fromCurr.addEventListener("select", this.convert());
  
    // toCurr.addEventListener("select", this.convert());
  }

  _convert(srcCurrSelect, srcField, dstCurrSelect, dstField) {
    const indexController = this;
  
    const fromField = srcField;
    const toField = dstField;
    const fromCurr = srcCurrSelect;
    const toCurr = dstCurrSelect;
  
    const expectedCurrency = `${fromCurr.value}_${toCurr.value}`;
    // console.log(`Expected currency: ${expectedCurrency}`);
  
    return indexController._dbPromise.then(function(db) {
      return db.transaction(RATES_STORE)
                .objectStore(RATES_STORE)
                .get(expectedCurrency);
    }).then(function(storedRecord){
      if(storedRecord) {
          console.log(`${expectedCurrency} is available at rate ${storedRecord.rate} from the database`);
  
          toField.value = Number(storedRecord.rate * fromField.value).toFixed(2);
      }
      
      // Rate not found in the database, fetch from the API
      console.log('Fetching rates from the network');
  
      fetch(`${CONVERSION_URL}${expectedCurrency}`)
            .then(function(response) {
                return response.json();
            })
            .then(function(jsonData) {
                // console.log(jsonData);
                
                if(!jsonData)
                    return;
                
                // Add the rate fetched into the database
                indexController._dbPromise.then(function(db) {
                    if (!db) return;
  
                    var tx = db.transaction(RATES_STORE, 'readwrite');
                    var store = tx.objectStore(RATES_STORE);
                    Object.keys(jsonData).forEach(curr => {
                      // console.log(curr, '->', jsonData[curr]);
                      store.put({id: curr, rate: jsonData[curr]});
                    });
                    
                    store.get(expectedCurrency).then(function(dbCurr) {
                      // console.log(`${expectedCurrency} = ${dbCurr.rate} was saved in the database`);
                      
                      toField.value = Number(dbCurr.rate * fromField.value).toFixed(2);
                    });
              });
            });
    });
  }
}