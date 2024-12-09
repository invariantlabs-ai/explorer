import React from 'react'

/**
 * Formats a given timestamp or date into a human readable format relative to now.
 * 
 * @param props.children The timestamp or date to format.
 * @param props.text If true, only the text will be returned, not a span with the full date.
 * @param props.noNow If true, this will never return "Just now" for timestamps that are less than a minute old but instead show the exact seconds.
 * @param props.className Additional class name to apply to the span (if not in 'text' mode).
 * 
 */
export function Time(props: { children: string | Date, text?: boolean, noNow?: boolean, className?: string }) {
    const timestamp = props.children.toString()
    // for anything older than 6m show date, otherwise show time passed
    const date = new Date(timestamp)
    const now = new Date()
    const diff = Number(now) - Number(date)
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const years = Math.floor(months / 12)

    let text = null as null | React.ReactNode

    if (years > 0) {
        text = <>{years} year{years > 1 ? 's' : ''} ago</>
    } else if (months > 0) {
        text = <>{months} month{months > 1 ? 's' : ''} ago</>
    } else if (days > 0) {
        text = <>{days} day{days > 1 ? 's' : ''} ago</>
    } else if (hours > 0) {
        text = <>{hours} hour{hours > 1 ? 's' : ''} ago</>
    } else if (minutes > 0) {
        text = <>{minutes} minute{minutes > 1 ? 's' : ''} ago</>
    } else {
        if (!props.noNow) {
            text = <>{seconds} second{seconds > 1 ? 's' : ''} ago</>
        } else {
            text = <>Just now</>
        }
    }

    if (props.text) {
        return text;
    }

    return <span className={'swap-on-hover ' + (props.className || '')}>
        <span> {text} </span>
        <span>{date.toLocaleString()}</span>
    </span>
}