import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Modal } from './Modal'
import { EntityList, DatasetList } from './EntityList'
import { Link, useLoaderData } from 'react-router-dom'


function User() {
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
  <DatasetList datasets={datasets} empty={"No Public Datasets"} />
</div>
}

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
