import './App.css'
import React from 'react'

function fetchActivity(callback: (activity: string) => void) {
  return fetch('/api/v1/activity')
    .then(response => response.json())
    .then(data => callback(data.activity))
}

interface UserInfo {
  username: string
  name: string
  email: string
}

function useUserInfo(): UserInfo | null {
  const [userInfo, setUserInfo] = React.useState(null)

  React.useEffect(() => {
    fetch('/api/v1/user/info')
      .then(response => response.json())
      .then(data => setUserInfo(data))
  }, [])

  return userInfo;
}

function useActivity() {
  const [activity, setActivity] = React.useState('')

  React.useEffect(() => {
    fetchActivity(setActivity)
  }, [])

  return activity
}

function Home() {
  const activity = useActivity()
  const userInfo = useUserInfo()

  return <>
    <h1>Welcome</h1>
    <p>
      Hello {userInfo?.name || 'there'}!
    </p>
    <p>
      {JSON.stringify(activity)}
    </p>
    <a href='/logout'>Logout</a>
  </>
}

export default Home
