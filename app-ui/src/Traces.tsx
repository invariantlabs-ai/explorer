import React from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsFileBinaryFill, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'

import { Explorer } from './TraceView'

interface DatasetData {
  id: string
  name: string
  extra_metadata: string
}

function useDataset(datasetId: string): DatasetData | null {
  const [dataset, setDataset] = React.useState(null)

  React.useEffect(() => {
    fetch(`/api/v1/dataset/${datasetId}`).then(response => {
      if (response.ok) {
        response.json().then(data => {
          setDataset(data)
        })
      }
    })
  }, [datasetId])

  return dataset
}

function Traces() {
  const props: {datasetId: string, bucketId: string} = useLoaderData() as any
  const dataset = useDataset(props.datasetId)

  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  return <div className="panel explorer app">
    <Explorer header={<h1>
        <Link to='/'>Datasets</Link> / <Link to={`/dataset/${props.datasetId}`}>{dataset?.name}</Link> / {props.bucketId}
      </h1>}/>
  </div>
}

export default Traces
