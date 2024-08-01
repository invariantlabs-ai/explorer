import React from 'react'

export interface UserInfo {
    id: string
    username: string
    name: string
    email: string
  }

export function useUserInfo(): UserInfo | null {
    const [userInfo, setUserInfo] = React.useState(null)
  
    React.useEffect(() => {
      fetch('/api/v1/user/info')
        .then(response => response.json())
        .then(data => setUserInfo(data))
    }, [])
  
    return userInfo;
  }
  