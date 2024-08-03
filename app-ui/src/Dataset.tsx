import React from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsFileBinaryFill, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'
import { BiSolidCommentDetail } from 'react-icons/bi'
import { sharedFetch } from './SharedFetch'

interface Bucket {
  id: string
  name: string
  count: number
}

interface DatasetData {
  id: string
  name: string
  extra_metadata: string
  buckets: Bucket[]
}

function useDataset(datasetId: string): DatasetData | null {
  const [dataset, setDataset] = React.useState(null)

  React.useEffect(() => {
    sharedFetch(`/api/v1/dataset/${datasetId}`).then(data => {
      setDataset(data)
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
  const iconMap: {[key: string]: React.ReactNode} = {
    'all': <BsCheckCircleFill/>,
    'annotated': <BsPencilFill style={{color: 'green'}}/>,
    'unannotated': <BsQuestionCircleFill style={{color: 'gold'}}/>,
  }

  return <Link to={`/dataset/${datasetId}/${id}`}>
    <div className={'bucket ' + (active ? 'active' : '')}>
      <div className='icon'>{icon || iconMap[id] || null}</div>
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
    <h4>Collections</h4>
    <div className='bucket-list'>
      {dataset.buckets.map(bucket => {
        return <Bucket datasetId={dataset.id} {...bucket} active={bucket.id == activeBucket} key={bucket.name} onSelect={() => setActiveBucket(bucket.id)}/>
      })}
    </div>
    <h4>Recent Activity</h4>
    <br/>
    TODO
  </div>
}

export default Dataset
