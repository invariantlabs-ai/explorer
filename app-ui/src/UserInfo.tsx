import React from 'react'
import { sharedFetch } from './SharedFetch'

export interface UserInfo {
  id: string
  username: string
  name: string
  email: string
  loggedIn?: boolean
}

const ANON = {
  id: '<anonymous>',
  username: '',
  name: 'Not Logged In',
  email: '',
  loggedIn: false,
}

export function useUserInfo(): UserInfo | null {
  const [userInfo, setUserInfo] = React.useState(null as UserInfo | null)

  React.useEffect(() => {
    sharedFetch('/api/v1/user/info')
      .then(data => {
        if (data.id == null) {
          setUserInfo(ANON)
        } else
          setUserInfo({
            ...data,
            loggedIn: true
          })
      })
      .catch(() => setUserInfo(ANON))
  }, [])

  return userInfo;
}
