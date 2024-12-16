// @ts-nocheck 

import { useState, useEffect, useRef, useCallback, act } from 'react'
import React from 'react'

function endpoint(url) {
  /*   const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    if (isDev) {
      return "https://localhost" + url;
    }
   */
  return url;
}

/**
 * CRUD manager for a given remote resource.
 * 
 * Exposes functions to fetch, update, delete and create objects.
 */
class RemoteResource {
  constructor(fetchUrl, updateUrl, deleteUrl, createUrl) {
    this.fetchUrl = fetchUrl
    this.updateUrl = updateUrl
    this.deleteUrl = deleteUrl
    this.createUrl = createUrl

    this.status = 'initialized'
    this.data = null

    this.onLoadedPromises = []
    this.onDataChangeListeners = []
    this.errorListeners = [console.error]
  }

  onErrors(listener) {
    this.errorListeners.push(listener)
  }

  offErrors(listener) {
    this.errorListeners = this.errorListeners.filter(l => l !== listener)
  }

  onDataChange(listener) {
    this.onDataChangeListeners.push(listener)
  }

  offDataChange(listener) {
    this.onDataChangeListeners = this.onDataChangeListeners.filter(l => l !== listener)
  }

  refresh() {
    return this.fetch()
      .then(data => { }, error => { })
      .catch(error => this.errorListeners.forEach(listener => listener("Failed to refresh: " + error)))
  }

  fetch() {
    return new Promise((resolve, reject) => {
      // if already loading, just add listener
      if (this.status == 'loading') {
        this.onLoadedListeners.push({ resolve, reject })
        return
      }
      this.status = 'loading'
      this.onLoadedPromises.push({ resolve, reject })

      fetch(endpoint(this.fetchUrl), {
        method: 'GET'
      })
        .then(response => {
          if (response.status != 200) {
            reject(response)
          }
          return response.json()
        })
        .then(data => {
          data = this.transform(data)
          this.data = data
          this.status = 'ready'
          this.onLoadedPromises.forEach(({ resolve }) => resolve(data))
          this.onDataChangeListeners.forEach(listener => listener(data))
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          this.status = 'error'
          this.onLoadedPromises.forEach(({ reject }) => reject(error))
          this.onDataChangeListeners.forEach(listener => listener(null))
        });
    })
  }

  /**
   * Transform the data before storing it in the data loader.
   */
  transform(data) {
    return data
  }

  update(elementId, object) {
    if (!this.updateUrl) {
      throw new Error('Update not supported')
    }

    return new Promise((resolve, reject) => {
      const url = this.updateUrl + (elementId ? '/' + elementId : '')
      fetch(endpoint(url), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object)
      })
        .then(response => {
          if (response.status != 200) {
            throw new Error('Server responded with status ' + response.status)
          }
          return response.json
        })
        .then(data => {
          resolve(data)
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
  }

  delete(elementId) {
    if (!this.deleteUrl) {
      throw new Error('Delete not supported')
    }

    return new Promise((resolve, reject) => {
      fetch(endpoint(this.deleteUrl + '/' + elementId), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      }).then(response => {
        if (response.status != 200) {
          throw new Error('Server responded with status ' + response.status)
        }
        return response.json()
      }).then(data => {
        resolve(data)
      })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
  }

  create(object) {
    if (!this.createUrl) {
      throw new Error('Create not supported')
    }

    return new Promise((resolve, reject) => {
      fetch(endpoint(this.createUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object)
      })
        .then(response => response.json())
        .then(data => {
          resolve(data)
        })
        .catch((error) => {
          this.errorListeners.forEach(listener => listener(error))
          reject(error)
        })
    })
  }
}

// cached set of data loaders
const RESOURCE_LOADERS = {}

function useRemoteResource(DataLoaderConstructor, ...args): [any, string, any, RemoteResource] {
  const [dataLoader, setDataLoader] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  useEffect(() => {
    // if args are null
    if (args.some(a => a === null || a === undefined)) {
      setStatus('uninitialized')
      return
    }

    // first, check if we have a data loader for this constructor
    const key = DataLoaderConstructor.name + JSON.stringify(args)
    let _dataLoader = null
    if (RESOURCE_LOADERS[key]) {
      _dataLoader = RESOURCE_LOADERS[key]
      setDataLoader(_dataLoader)

      // register data change listener
      _dataLoader.onDataChange(setData)

      // check if already loaded
      if (_dataLoader.status == 'ready') {
        setStatus('ready')
        setData(_dataLoader.data)
      }

      return () => _dataLoader.offDataChange(setData)
    } else {
      _dataLoader = new DataLoaderConstructor(...args)
      RESOURCE_LOADERS[key] = _dataLoader
      setDataLoader(_dataLoader)

      // check if already loaded
      if (_dataLoader.status == 'ready') {
        setStatus('ready')
        setData(_dataLoader.data)
        return
      }

      // then initialize the data loader
      _dataLoader.fetch().then(data => {
        setStatus('ready')
        setData(data)
      }).catch((error) => {
        setError(error)
        setStatus('error')
        setData(null)
      })

      return () => _dataLoader.offDataChange(setData)
    }
  }, [args])

  return [data, status, error, dataLoader]
}

export {
  RemoteResource,
  useRemoteResource
}