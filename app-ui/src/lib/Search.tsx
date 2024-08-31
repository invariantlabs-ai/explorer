import './Search.scss'
import ClockLoader from "react-spinners/ClockLoader";
import { BsSearch, BsCaretDownFill } from "react-icons/bs";
import React, { useEffect } from "react";

function Search(props) {
    const timeout = props.timeout || 300;
    const [searchTimeout, setSearchTimeout] = React.useState<number | null>(null)
    const [isSearching, setIsSearching] = React.useState(false)
    const [query, _setQuery] = React.useState(props.query || '')
    const setQuery = (query:string) => {
        _setQuery(query)
        if (props.setQuery) {
            props.setQuery(query)
        }
    }
    useEffect(() => {
        setQuery(props.query || '')
    }, [props.query])
    

    const doSearch = (query:string) => {
        setSearchTimeout(window.setTimeout(() => {
                setIsSearching(true)
                props.search(query).finally(() => {
                    setSearchTimeout(null)
                    setIsSearching(false)
                })
            }, timeout))
    }

    const reset = () => {
        if (searchTimeout) {
            clearTimeout(searchTimeout)
            setSearchTimeout(null)
        }
    }
      
    useEffect(() => {
        if (query && query.length > 0) {
            doSearch(query)
        }
    }, [query])
    

    const update = (e) => {
        if (e.key === 'Enter') {
            reset()
            setQuery(e.target.value)
        } else if (e.key === 'Escape') {
            reset()
            e.target.value = ''
            setQuery('')
        } else {
            setQuery(e.target.value)
        }
    }
    
    const clickSelect = (e) => {
        const dropdown = e.target.parentElement.parentElement.parentElement.querySelector('.search-select-dropdown')
        if (dropdown) {
            dropdown.classList.toggle('search-select-dropdown-show')
        }
    }
    
    const addFilter = (e, filter) => {
        setQuery(filter + ' ' + query)
        const dropdown = e.target.parentElement.parentElement.parentElement.parentElement.querySelector('.search-select-dropdown')
        if (dropdown) {
            dropdown.classList.toggle('search-select-dropdown-show')
        }
    }

    return <>
     <div className='search'>
        <button className='search-select' onClick={clickSelect}>
            <BsCaretDownFill />
        </button>
         <div className='search-select-dropdown'>
         <ul>
            <li onClick={(e)=>{addFilter(e, 'is:annotated')}} >Has Annotation</li>
            <li onClick={(e)=>{addFilter(e, 'not:annotated')}} >No Annotation</li>
         </ul>
         </div>
        <input className='search-text' type="text" onChange={update} value={query} placeholder="Search" />
        <button className='search-submit' onClick={()=>{ /* TODO: search */ }}>
            {!isSearching && <BsSearch />}
            {isSearching && <ClockLoader size={'15'} margin={0} />}
        </button>
    </div>
    </>
}

export default Search