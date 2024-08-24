//@ts-nocheck
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
  constructor(username: string, datasetname: string) {
    super(
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}`,
      `/api/v1/dataset/byuser/${username}/${datasetname}` 
    )
    //@ts-ignore
    this.username = username
    this.datasetname = datasetname
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

function Bucket({dataset, id, name, count, active, icon, onSelect}: {dataset, id: string, name: string, count: number, active?: boolean, icon?: React.ReactNode, onSelect?: () => void}) {
  const iconMap: {[key: string]: React.ReactNode} = {
    'all': <BsCheckCircleFill/>,
    'annotated': <BsPencilFill style={{color: 'green'}}/>,
    'unannotated': <BsQuestionCircleFill style={{color: 'gold'}}/>,
  }

  return <Link to={`/user/${dataset.user.username}/dataset/${dataset.name}/${id}`}>
    <div className={'bucket ' + (active ? 'active' : '')}>
      <div className='icon'>{icon || iconMap[id] || null}</div>
      <div className='count'>{count}</div>
      <div className='name'>{name}</div>
    </div>
  </Link>
}

function DatasetView() {
  const props: any = useLoaderData()
  const [dataset, datasetStatus, datasetError, datasetLoader] = useRemoteResource(Dataset, props.username, props.datasetname)
  const [activeBucket, setActiveBucket] = React.useState(null as string | null)
  const userInfo = useUserInfo()

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
        <Link to={userInfo?.id == dataset?.user.id ? '/' : '/user/' + dataset.user.username }>{dataset.user.username || 'Datasets'}</Link> / {dataset?.name}
        {dataset.is_public && <span className='description'> <BsGlobe/></span>}
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
    <input type='checkbox' name='public' id='public' checked={dataset.is_public} onChange={onPublicChange} disabled={dataset.user.id != userInfo?.id}/>
    </div>
    <h4>Collections</h4>
    <div className='bucket-list'>
      {dataset.buckets.map(bucket => {
        return <Bucket dataset={dataset} {...bucket} active={bucket.id == activeBucket} key={bucket.name} onSelect={() => setActiveBucket(bucket.id)}/>
      })}
    </div>
    <h4>Recent Activity</h4>
    <br/>
    TODO
  </div>
}

export default DatasetView
