//@ts-nocheck
import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsCheckCircleFill, BsFileBinaryFill, BsMoonStarsFill, BsPencilFill, BsQuestionCircleFill, BsTerminal, BsTrash, BsUpload, BsGlobe, BsDownload } from 'react-icons/bs'
import { Link, useLoaderData, useNavigate } from 'react-router-dom'
import { BiSolidCommentDetail } from 'react-icons/bi'
import { sharedFetch } from './SharedFetch'
import { RemoteResource, useRemoteResource } from './RemoteResource';
import { Metadata } from './lib/metadata'
import { DeleteDatasetModalContent } from './Datasets'
import { Modal } from './Modal'


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
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  const [downloadState, setDownloadState] = React.useState('ready')
  
  const navigate = useNavigate()

  
  const userInfo = useUserInfo()

  const onPublicChange = (e) => {
    datasetLoader.update(null, {content: e.target.checked})
    .then(() => {
            datasetLoader.refresh()
          }).catch((error) => {
            alert('Failed to save annotation: ' + error)
          })
  }

  const onDownloadDataset = (event) => {
    if (downloadState ==='ready') {
      setDownloadState('waiting')
      fetch('/api/v1/dataset/byid/' + dataset.id + '/full').then(response => {
        if (!response.ok) {
          throw new Error('could net fetch dataset')
        }
        return response.json()}).then(data => {
          const link = document.createElement('a')
          var out = ''
          data.traces.forEach(trace => {
            out += JSON.stringify(trace) + '\n'
          })
          link.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(out)
          link.setAttribute('download', dataset.name + '.jsonl')
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          setDownloadState('ready')
      }).catch(err => {
        setDownloadState('ready')
        alert('Could not download the dataset.')
      })
    }
    event.preventDefault()
  }
 
  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  return <div className="panel entity-list">
    <header>
      <h1>
        <Link to={userInfo?.id == dataset?.user.username ? '/' : ('/user/' + dataset.user.username) }>{dataset.user.username || 'Datasets'}</Link> / {dataset?.name}
        {dataset.is_public && <span className='badge'>Public</span>}
      </h1>
    </header>
    {/* delete modal */}
    {selectedDatasetForDelete && <Modal title="Delete Dataset" onClose={() => setSelectedDatasetForDelete(null)} hasWindowControls>
      <DeleteDatasetModalContent dataset={selectedDatasetForDelete} onClose={() => setSelectedDatasetForDelete(null)} onSuccess={() => navigate("/")}></DeleteDatasetModalContent>
    </Modal>}
    <Metadata extra_metadata={dataset?.extra_metadata}/>
    <h2>Traces</h2>
    <div className='bucket-list'>
      {dataset.buckets.map(bucket => {
        return <Bucket dataset={dataset} {...bucket} active={bucket.id == activeBucket} key={bucket.name} onSelect={() => setActiveBucket(bucket.id)}/>
      })}
    </div>
    <h2>Other Actions</h2>
    <br/>
    <div className="actions">
      {dataset?.user?.id == userInfo?.id && <div className='box full setting'>
      <p>
        <h3>Delete Entire Dataset</h3>
        Delete this dataset and all associated data. This action cannot be undone.
      </p>
      <button className='danger' onClick={() => setSelectedDatasetForDelete(dataset)}>
        <BsTrash/> Delete
      </button>
      </div>}
      {/* <div>
    <label htmlFor='public'><h4>Public</h4></label>
    <input type='checkbox' name='public' id='public' checked={dataset.is_public} onChange={onPublicChange} disabled={dataset.user.id != userInfo?.id}/>
    </div> */}
    {dataset?.user?.id == userInfo?.id && <div className='box full setting'>
      <p>
        <h3>Publish</h3>
        Make this dataset public. This will allow other users to view and annotate the data ({dataset.is_public ? 'currently public' : 'currently private'}).
      </p>
      <button className={!dataset.is_public ? 'primary' : ''}
      onClick={() => onPublicChange({target: {checked: !dataset.is_public}})}>
        <BsGlobe/> {dataset.is_public ? 'Make Private' : 'Publish'}
      </button>
    </div>}
    <div className='box full setting'>
      <p>
        <h3>Export Dataset</h3>
        Download a copy of the dataset.
      </p>
      <button className='primary' onClick={() => onDownloadDataset()}>
        <BsDownload/> Download
        {downloadState === 'waiting' && <BsMoonStarsFill/>}
      </button>
    </div>
  </div>
  </div>
}

export default DatasetView
