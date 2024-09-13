import React from 'react'
import { useLoaderData } from 'react-router-dom'
import { DatasetLinkList } from './Datasets'


/**
 * Component for displaying a user's public datasets, i.e. the user's profile page.
 */
function User() {
  // get selected user from loader data (populated by site router)
  const props: any = useLoaderData()
  const username = props.username
  
  const [datasets, refreshDatasets] = useDatasetList()

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
function useDatasetList(): [any[], (username: string) => void] {
  const props: any = useLoaderData()
  const username = props.username
  const [datasets, setDatasets] = React.useState<any[]>([])

  const refresh = (username) => {
    fetch('/api/v1/dataset/list/byuser/' + username).then(response => {
      if (response.ok) {
        response.json().then(data => {
          setDatasets(data)
        })
      }
    })
  }

  React.useEffect(() => refresh(username), [username])

  return [
    datasets,
    refresh
  ]
}

export default User
