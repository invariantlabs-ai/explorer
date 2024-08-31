import './Search.scss'
import ClockLoader from "react-spinners/ClockLoader";
import { BsSearch } from "react-icons/bs";
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
    

    const onKeyUp = (e) => {
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

    return <>
     <div className='search'>
        { props?.showSelect &&
            <select className='search-select'>
                <option>a</option>
            </select>
        }
        <input className='search-text' type="text" onChange={onKeyUp} value={query} placeholder="Search" />
        <button className='search-submit'>
            {!isSearching && <BsSearch />}
            {isSearching && <ClockLoader size={'15'} margin={0} />}
        </button>
    </div>
    </>
}

export default Search