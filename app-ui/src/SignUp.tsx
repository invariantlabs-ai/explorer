import React, { useState, useEffect } from 'react'

export function SignUp() {
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const onSignUp = () => {
    setIsLoading(true)

    fetch('/api/v1/user/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agree: true
      })
    }).then((response) => {
      setIsLoading(false)
      if (response.status === 200) {
        window.location.href = '/'
      } else {
        setError('Failed to sign up')
      }
    }).catch((error) => {
      setIsLoading(false)
      setError('Failed to sign up')
    })
  };

  return <div className="panel fullscreen app">
    <div className="signup">
      <h2>
        Sign Up for Explorer
      </h2>
      <p>
        By signing up, you agree to our privacy policy and terms of service.<br /><br />
        Please note that this is an early preview of the application and that we may store your data for research purposes.
      </p>
      {error && <div className="error">Error: {error}</div>}
      <div className='signup-actions'>
        <a href='/logout' className="button secondary">
          Cancel
        </a>
        <button className="primary" onClick={onSignUp}>
          Agree and Continue
        </button>
      </div>
    </div>
  </div>
}