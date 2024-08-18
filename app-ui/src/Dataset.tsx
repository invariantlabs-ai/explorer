import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsFileBinaryFill, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload, BsGlobe } from 'react-icons/bs'
import { Link, useLoaderData } from 'react-router-dom'
import { BiSolidCommentDetail } from 'react-icons/bi'
import { sharedFetch } from './SharedFetch'
import { RemoteResource, useRemoteResource } from './RemoteResource';

interface Bucket {
  id: string
  name: string
  count: number
}

interface DatasetData {
  public: any
  id: string
  name: string
  is_public: boolean
  extra_metadata: string
  buckets: Bucket[]
}


class Dataset extends RemoteResource {
  constructor(datasetId) {
    super(`/api/v1/dataset/${datasetId}`,
          `/api/v1/dataset/${datasetId}`,
          `/api/v1/dataset/${datasetId}`,
          `/api/v1/dataset/${datasetId}`
    )
    this.datasetId = datasetId
  }

}


function metadata(dataset) {
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

function DatasetView() {
  //const props: {datasetId: string} = useLoaderData() as any
  const props = useLoaderData()
  const [dataset, datasetStatus, datasetError, datasetLoader] = useRemoteResource(Dataset, props.datasetId)
  //const dataset = {'buckets': []}
  //const dataLoader = null
  console.log('dataset', dataset)
  const [activeBucket, setActiveBucket] = React.useState(null as string | null)

  const onPublicChange = (e) => {
    datasetLoader.update(null, {content: e.target.checked})
    .then(() => {
            datasetLoader.refresh()
          }).catch((error) => {
            alert('Failed to save annotation: ' + error)
          })

  }
 
  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  return <div className="panel entity-list">
    <header>
      <h1>
        <Link to='/'>Datasets</Link> / {dataset?.name}
        {dataset.is_public && <span className='description'><BsGlobe/></span>}
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
    <div>
    <label htmlFor='public'><h4>Public</h4></label>
    <input type='checkbox' name='public' id='public' checked={dataset.is_public} onChange={onPublicChange}/>
    TODO: make this a toggle
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

export default DatasetView
