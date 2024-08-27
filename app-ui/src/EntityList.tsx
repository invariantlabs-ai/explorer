import React from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'

function EntityList(props) {
  return <div className={"panel entity-list " + (props.className || '')}>
    {(props.title || props.actios) && <header>
      {props.title && <>
        <h1>{props.title}</h1>
        <div className="spacer"/>
      </>}
      {props.actions && <div className="actions">
        {props.actions}
      </div>}
    </header>}
    <ul>
      {props.children}
    </ul>
  </div>
}

function DatasetList(props) {
  const userInfo = useUserInfo()
  const datasets = props.datasets || [];
  const [downloadState, setDownloadState] = React.useState({})
  
  const hasActions = typeof props.hasActions === 'undefined' ? true : props.hasActions
  
  React.useEffect(() => {
    let state = downloadState || {}
    for (const dataset of datasets) {
      if (state[dataset.id] === undefined) {
        state[dataset.id] = 'ready'
      }
    }
    setDownloadState(state)
  }, [datasets])
  const onDownloadDataset = (dataset) => {
    return (event) => {
      if (downloadState[dataset.id] ==='ready') {
        setDownloadState({...downloadState, [dataset.id]: 'waiting'})
        fetch('/api/v1/dataset/full/'+dataset.id).then(response => {
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
            setDownloadState({...downloadState, [dataset.id]: 'ready'})
        }).catch(err => {
          setDownloadState({...downloadState, [dataset.id]:'ready'})
          alert('Could not download the dataset.')
        })
      }
      event.preventDefault()
    }
  }

return <>
    <EntityList title={props.title} actions={props.actions} className={props.className}>
      {datasets.length === 0 && <div className='empty'>No datasets</div>}
      {datasets.map((dataset, i) => <Link className='item' to={`/user/${dataset.user.username}/dataset/${dataset.name}`} key={i}><li>
        <h3>{dataset.user.username}/{dataset.name}</h3>
        {!props.compact && <>
          <span className='description'>
            {dataset.extra_metadata}
          </span>
          <div className='spacer'/>
          {hasActions && <div className='actions'>
            <button className='tool' onClick={onDownloadDataset(dataset)}>
              {downloadState[dataset.id] == 'ready' && <BsDownload/>}
              {downloadState[dataset.id] == 'waiting' && <BsClockHistory/>}
              {downloadState[dataset.id] != 'ready' && downloadState[dataset.id] != 'waiting' && <BsDownload/>}
            </button>
            {dataset.user.username == userInfo?.username && props.onDelete && <button className='tool danger' onClick={(e) => {
              e.preventDefault()
              props.onDelete(dataset)
            }}><BsTrash/></button>}
            <button className='primary'>View</button>
          </div>}
        </>}
      </li></Link>)}
    </EntityList>
</>
}



export function DatasetLinkList(props) {
  const userInfo = useUserInfo()
  const datasets = props.datasets || [];
  
  const hasActions = typeof props.hasActions === 'undefined' ? true : props.hasActions
  
  return <>
    <EntityList title={null} actions={null} className={props.className}>
      {datasets.length === 0 && <div className='empty'>No datasets</div>}
      {datasets.map((dataset, i) => <Link className='item' to={`/user/${dataset.user.username}/dataset/${dataset.name}`} key={i}><li>
        <h3>{dataset.user.username}/{dataset.name}</h3>
      </li></Link>)}
    </EntityList>
</>
}

export {EntityList, DatasetList}