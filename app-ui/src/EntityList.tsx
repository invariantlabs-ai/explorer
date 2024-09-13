import React from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'

/**
 * Simple styled list of entities (e.g. datasets, snippets, traces, API keys, etc.).
 */
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

export {EntityList}