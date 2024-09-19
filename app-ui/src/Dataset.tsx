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


interface Query {
  id: string
  name: string
  count: number
  query: string
}

interface DatasetData {
  public: any
  id: string
  name: string
  is_public: boolean
  extra_metadata: string
  queries: Query[]
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

function Query({dataset, id, name, count, query, deletable, icon, onSelect, refresh}: {dataset, id: string, name: string, count: number, query: string, deletable: boolean, icon?: React.ReactNode, onSelect?: () => void, refresh: () => void}) {
  const iconMap: {[key: string]: React.ReactNode} = {
    'all': <BsCheckCircleFill/>,
    'annotated': <BsPencilFill style={{color: 'green'}}/>,
    'unannotated': <BsQuestionCircleFill style={{color: 'gold'}}/>,
  }

  const deleteQuery = (e) => {
    if (deletable) {
      fetch(`/api/v1/dataset/query/${id}`, {
        'method': 'DELETE',
      }).then(() => {
        alert('query delete')
        refresh()
      }).catch((error) => {
        alert('Failed to delete query: ' + error)
      })
    }
    e.preventDefault()
  }
  
  return <>

    <div className={'query'}>
      <Link to={`/u/${dataset.user.username}/${dataset.name}/t` + (query ? '?query='+query : '')}>
          <div className='icon'>{icon || iconMap[id] || null}</div>
          <div className='count'>{count}</div>
          <div className='name'>{name}</div>
      </Link>
    {deletable &&
      <button onClick={deleteQuery}><BsTrash/></button>
    }
    </div>
  </>
}

/**
 * Component for displaying a single dataset related functionality (view, edit, delete, download, etc.)
 */
function DatasetView() {
  // get dataset id from loader data (populated by site router)
  const props: any = useLoaderData()
  
  // loads details about the dataset from the API
  const [dataset, datasetStatus, datasetError, datasetLoader] = useRemoteResource(Dataset, props.username, props.datasetname)
  // tracks whether the Delete Dataset modal is open
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  // tracks whether the dataset is ready for download
  const [downloadState, setDownloadState] = React.useState('ready')
  // used to navigate to a new page
  const navigate = useNavigate()
  // obtains the active user's information (if signed in)
  const userInfo = useUserInfo()


  // callback for when a user toggles the public/private status of a dataset
  const onPublicChange = (e) => {
    datasetLoader.update(null, {content: e.target.checked})
    .then(() => {
            datasetLoader.refresh()
          }).catch((error) => {
            alert('Failed to save annotation: ' + error)
          })
  }

  // callback for when a user downloads a dataset
  const onDownloadDataset = (event) => {
    if (downloadState ==='ready') {
      // indicate that the download is being prepared
      setDownloadState('waiting')
      // trigger the download
      fetch('/api/v1/dataset/byid/' + dataset.id + '/full').then(response => {
        if (!response.ok) {
          throw new Error('could net fetch dataset')
        }
        // waits for the response to be completed
        return response.json()}).then(data => {
          // only once ready, create a link to download the dataset
          const link = document.createElement('a')
          var out = ''
          data.traces.forEach(trace => {
            out += JSON.stringify(trace) + '\n'
          })
          link.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(out)
          link.setAttribute('download', dataset.name + '.jsonl')
          document.body.appendChild(link)
          
          // click link synthetically to trigger actual download
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
 
  // if the dataset is not loaded yet, display a loading message
  if (!dataset) {
    return <div className='empty'>
      <h3>Loading...</h3>
    </div>
  }

  // if the dataset is not found, display a message
  return <div className="panel entity-list">
    <header>
      <h1>
        <Link to={userInfo?.id == dataset?.user.username ? '/' : ('/u/' + dataset.user.username) }>{dataset.user.username || 'Datasets'}</Link> / {dataset?.name}
        {dataset.is_public && <span className='badge'>Public</span>}
      </h1>
    </header>
    {/* delete modal */}
    {selectedDatasetForDelete && <Modal title="Delete Dataset" onClose={() => setSelectedDatasetForDelete(null)} hasWindowControls>
      <DeleteDatasetModalContent dataset={selectedDatasetForDelete} onClose={() => setSelectedDatasetForDelete(null)} onSuccess={() => navigate("/")}></DeleteDatasetModalContent>
    </Modal>}
    {/* dataset metadata (e.g. time uploaded, uploader, num traces) */}
    <Metadata extra_metadata={{...dataset?.extra_metadata, id: dataset.id}}/>
    <h2>Traces</h2>
    <div className='query-list'>
      {dataset.queries.map(query => {
        return <Query dataset={dataset} {...query} key={query.name} refresh={() => {datasetLoader.refresh()}}/>
      })}
    </div>
    <h2>Other Actions</h2>
    <br/>
    <div className="actions">
      {dataset?.user?.id == userInfo?.id && <div className='box full setting'>
      <div>
        <h3>Delete Entire Dataset</h3>
        Delete this dataset and all associated data. This action cannot be undone.
      </div>
      <button aria-label="delete" className='danger' onClick={() => setSelectedDatasetForDelete(dataset)}>
        <BsTrash/> Delete
      </button>
      </div>}
    {dataset?.user?.id == userInfo?.id && <div className='box full setting'>
      <div>
        <h3>Publish</h3>
        Make this dataset public. This will allow other users to view and annotate the data ({dataset.is_public ? 'currently public' : 'currently private'}).
      </div>
      <button className={!dataset.is_public ? 'primary' : ''}
      onClick={() => onPublicChange({target: {checked: !dataset.is_public}})}>
        <BsGlobe/> {dataset.is_public ? 'Make Private' : 'Publish'}
      </button>
    </div>}
    <div className='box full setting'>
      <div>
        <h3>Export Dataset</h3>
        Download a copy of the dataset.
      </div>
      <button aria-label="download" className='primary' onClick={() => onDownloadDataset()}>
        {downloadState !== 'waiting' && <><BsDownload/> Download</>}
        {downloadState === 'waiting' && <><BsMoonStarsFill/> Preparing...</>}
      </button>
    </div>
  </div>
  </div>
}

export default DatasetView;
