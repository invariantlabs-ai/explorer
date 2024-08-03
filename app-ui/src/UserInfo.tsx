import React from 'react'
import { sharedFetch } from './SharedFetch'

export interface UserInfo {
    id: string
    username: string
    name: string
    email: string
  }

export function useUserInfo(): UserInfo | null {
    const [userInfo, setUserInfo] = React.useState(null)
  
    React.useEffect(() => {
      sharedFetch('/api/v1/user/info')
        .then(data => setUserInfo(data))
    }, [])
  
    return userInfo;
  }
  