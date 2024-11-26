import { register_plugin } from '../plugins';
import React from 'react';

// component properties of the code-highlighter plugin
interface ImageViewerProps {
    content: string;
    datasetName: string;
    traceId: string;
    imageId: string;
}

function extractImageId(content: string): { datasetName: string | null, traceId: string | null, imageId: string | null } {
    let pattern: string;
    if (content.includes("s3_img_link")) {
        pattern = 's3_img_link: s3://invariant-explorer-imgs/(.*)\.png'
    } else {
        pattern = 'local_img_link: /srv/images/(.*)\.png'
    }
    const match = content.match(pattern);

    if (!match) {
        return { datasetName: null, traceId: null, imageId: null };
    }

    const parts = match[1].split('/');
    return {
        datasetName: parts[0],
        traceId: parts[1],
        imageId: parts[2]
    };
}


class ImageViewer extends React.Component<ImageViewerProps, { 
    nodes: any, 
    datasetName: string | null, 
    traceId: string | null, 
    imageId: string | null,
    imageUrl: string | null
}> {
    constructor(props) {
        super(props);
        const imageInfo = extractImageId(props.content);
        this.state = {
            nodes: [],
            datasetName: imageInfo.datasetName,
            traceId: imageInfo.traceId,
            imageId: imageInfo.imageId,
            imageUrl: null
        };
    }

    async componentDidMount() {
        await this.fetchImage();
    }

    async componentDidUpdate(prevProps) {
        if (prevProps.content !== this.props.content) {
            const imageInfo = extractImageId(this.props.content);
            this.setState({
                datasetName: imageInfo.datasetName,
                traceId: imageInfo.traceId,
                imageId: imageInfo.imageId,
                imageUrl: null
            }, () => {
                this.fetchImage();
            });
        }
    }

    async fetchImage() {
        const url = `/api/v1/trace/image/${this.state.datasetName}/${this.state.traceId}/${this.state.imageId}`;
        
        try {
            const cache = await caches.open('trace-images');
            let response = await cache.match(url);

            if (!response) {
                response = await fetch(url);
                if (!response.ok) {
                    throw new Error('Image fetch failed');
                }
                // Clone the response before caching because response body can only be used once
                const responseClone = response.clone();
                await cache.put(url, responseClone);
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            this.setState({ imageUrl });
        } catch (error) {
            console.error('Error fetching image:', error);
        }
    }

    render() {
        return <div className='plugin code-image-viewer'>
            {this.state.imageUrl && (
                <img 
                    src={this.state.imageUrl} 
                    alt="Trace visualization" 
                    style={{ maxWidth: '50%', marginTop: '10px' }}
                />
            )}
        </div>;
    }
}

// register the image-viewer plugin
register_plugin({
    name: 'image-viewer',
    component: (props) => <ImageViewer {...props} />,
    isCompatible: (address: string, msg: any, content: string) => {
        if (content.includes("s3_img_link") || content.includes("local_img_link")) {
            return true;
        }
        return false;
    }
});
