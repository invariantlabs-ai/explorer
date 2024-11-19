import React, { useState, useEffect } from 'react'
import Markdown from 'react-markdown'

export default function MarkdownFile(props: { contents: string }) {
  return <Markdown className='markdown'>{props.contents}</Markdown>
}