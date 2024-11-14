import React, { useState, useEffect } from 'react'
import Markdown from 'react-markdown'

export default function MarkdownFile(props: { file: string }) {
    const [content, setContent] = useState('Loading');
    fetch('/src/assets/' + props.file).then((res) => {
        console.log(res);
        if (!res.ok) {
            setContent('## Failed to load file');
        }
        return res.text();
    }).then((text) => {
        setContent(text);
    })
  return <Markdown className='markdown'>{content}</Markdown>
}