import React from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsFileBinaryFill, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'
import { BiSolidCommentDetail } from 'react-icons/bi'

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

function metadata(dataset: DatasetData | null) {
  if (!dataset) {
    return [];
  }
  try {
    let metadata = JSON.parse(dataset?.extra_metadata)

    return Object.keys(metadata).map(key => {
      return {
        key: key,
        value: metadata[key]
      }
    });
  } catch (e) {
    return []
  }
}

function Bucket({datasetId, id, name, count, active, icon, onSelect}: {datasetId: string, id: string, name: string, count: number, active?: boolean, icon?: React.ReactNode, onSelect?: () => void}) {
  return <Link to={`/dataset/${datasetId}/${id}`}>
    <div className={'bucket ' + (active ? 'active' : '')}>
      <div className='icon'>{icon}</div>
      <div className='count'>{count}</div>
      <div className='name'>{name}</div>
    </div>
  </Link>
}

function Dataset() {
  const props: {datasetId: string} = useLoaderData() as any
  const dataset = useDataset(props.datasetId)
  const [activeBucket, setActiveBucket] = React.useState(null as string | null)

  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  const buckets = [
    {
      id: "all",
      name: "All",
      count: 0
    },
    {
      id: "uncategorized",
      name: "Uncategorized",
      icon: <BsQuestionCircleFill style={{color: 'grey'}}/>,
      count: 0
    },
    {
      id: "success",
      name: "Success",
      icon: <BsCheckCircleFill style={{color: 'green'}}/>,
      count: 0
    },
    {
      id: "hallucinations",
      name: "Hallucinations",
      icon: <BsMoonStarsFill/>,
      count: 0
    }
  ]

  return <div className="panel entity-list">
    <header>
      <h1>
        <Link to='/'>Datasets</Link> / {dataset?.name}
      </h1>
      <div className="spacer"/>
      <div className="actions">
        <button className='primary' onClick={() => {}}>
          <BsTerminal/> Query
        </button>
      </div>
    </header>
    <div className='metadata-items'>
    {metadata(dataset).map(({key, value}) => {
      return <div className='metadata' key={key}>
        <label className='key'>{key}</label>
        <div className='value'>{value}</div>
      </div>
    })}
    </div>
    <h4>Buckets</h4>
    <div className='bucket-list'>
      {buckets.map(bucket => {
        return <Bucket datasetId={dataset.id} {...bucket} active={bucket.id == activeBucket} key={bucket.name} onSelect={() => setActiveBucket(bucket.id)}/>
      })}
    </div>
    <h4>Recent Activity</h4>
    <br/>
    TODO
  </div>
}

export default Dataset
