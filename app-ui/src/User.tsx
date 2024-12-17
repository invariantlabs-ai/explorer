import React from 'react'
import { useLoaderData } from 'react-router-dom'
import { DatasetLinkList } from './Datasets'
import { UserNotFound, isClientError } from './NotFound'

/**
 * Component for displaying a user's public datasets, i.e. the user's profile page.
 */
function User() {
  // get selected user from loader data (populated by site router)
  const props: any = useLoaderData()
  const username = props.username

  const [datasets, error] = useDatasetList()
  if (error) {
    if (isClientError(error.status)) {
      return UserNotFound({ username })
    } else {
      return <div className='empty'>
        <p>
          Error loading user.
        </p>
      </div>
    }
  }
  if (!datasets) {
    return <div className='empty'>
      <p>
        Loading...
      </p>
    </div>
  }
  return <div className="panel entity-list">
    <header>
      <h1>
        {username}
      </h1>
      <div className="spacer" />
      <div className="actions">

      </div>
    </header>
    <h2>Public Datasets</h2>
    <DatasetLinkList datasets={datasets} />
  </div>
}

// fetches list of public datasets for a user
function useDatasetList(): [any[] | null, Response | null] {
  const props: any = useLoaderData()
  const username = props.username
  const [datasets, setDatasets] = React.useState<any[] | null>(null);
  const [error, setError] = React.useState(null as Response | null);

  const refresh = (username) => {
    fetch('/api/v1/dataset/list/byuser/' + username).then(response => {
      if (response.status !== 200) {
        setError(response)
      } else {
        response.json().then(data => {
          setDatasets(data)
        })
      }})
  }

  React.useEffect(() => refresh(username), [username])

  return [
    datasets,
    error
  ]
}

export default User
