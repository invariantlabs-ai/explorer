const MULTILISTENER_FETCHES = {}

export function sharedFetch(url: string): Promise<any> {
  if (MULTILISTENER_FETCHES[url]) {
    return new Promise((resolve, reject) => {
      MULTILISTENER_FETCHES[url].push({resolve, reject})
    })
  }

  return new Promise((resolve, reject) => {
    MULTILISTENER_FETCHES[url] = [{resolve, reject}]

    const fetchPromise = fetch(url).then(response => {
      if (response.ok) {
        return response.json()
      } else {
        MULTILISTENER_FETCHES[url].forEach(({resolve, reject}) => {
          reject(response)
        })
        MULTILISTENER_FETCHES[url] = null
      }
    }).then(body => {
      MULTILISTENER_FETCHES[url].forEach(({resolve, reject}) => {
        resolve(body)
      })
      MULTILISTENER_FETCHES[url] = null
    }).catch(error => {
      MULTILISTENER_FETCHES[url].forEach(({resolve, reject}) => {
        reject(error)
      })
      MULTILISTENER_FETCHES[url] = null
    })
  })
}