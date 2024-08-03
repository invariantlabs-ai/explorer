import React from 'react'
import { sharedFetch } from './SharedFetch'

export interface UserInfo {
    id: string
    username: string
    name: string
    email: string
    loggedIn?: boolean
  }

export function useUserInfo(): UserInfo | null {
    const [userInfo, setUserInfo] = React.useState(null as UserInfo | null)
  
    React.useEffect(() => {
      sharedFetch('/api/v1/user/info')
        .then(data => setUserInfo({
          ...data,
          loggedIn: true
        }))
        .catch(() => setUserInfo({
          id: '<anonymous>',
          username: '',
          name: 'Not Logged In',
          email: '',
          loggedIn: false,
        }))
    }, [])
  
    return userInfo;
  }
  