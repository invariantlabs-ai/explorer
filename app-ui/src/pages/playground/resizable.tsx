import React, { useRef, useState, useEffect } from "react";
import * as ResizablePrimitive from "react-resizable-panels";

const ResizablePanelGroup = ({
  style,
  direction,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup> & {
  style?: React.CSSProperties;
}) => {
  const baseStyle: React.CSSProperties = {
    display: 'flex',
    height: '100%',
    width: '100%',
    flexDirection: direction === 'vertical' ? 'column' : 'row',
  };

  return (
    <ResizablePrimitive.PanelGroup
      style={{
        ...baseStyle,
        ...style,
      }}
      direction={direction}
      {...props}
    />
  );
};

// Create a wrapper for the Panel component to ensure all props are passed through
const ResizablePanel = ({
  defaultSize,
  minSize = 10,
  style,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel> & {
  defaultSize?: number;
  minSize?: number;
  style?: React.CSSProperties;
}) => {
  return (
    <ResizablePrimitive.Panel
      defaultSize={defaultSize}
      minSize={minSize}
      style={style}
      {...props}
    />
  );
};

// Custom grip handle icon as SVG
const GripIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="9" cy="9" r="1" />
    <circle cx="9" cy="15" r="1" />
    <circle cx="15" cy="9" r="1" />
    <circle cx="15" cy="15" r="1" />
  </svg>
);

const ResizableHandle = ({
  withHandle,
  style,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
  style?: React.CSSProperties;
}) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const [isVertical, setIsVertical] = useState(false);
  
  useEffect(() => {
    // Check if we're in a vertical panel group by examining parent elements
    const checkDirection = () => {
      if (!handleRef.current) return;
      
      // Look for a parent with data-panel-group-direction attribute
      let element: HTMLElement | null = handleRef.current;
      while (element && !element.hasAttribute('data-panel-group-direction')) {
        element = element.parentElement;
      }
      
      // Set vertical state based on the attribute value
      if (element) {
        setIsVertical(element.getAttribute('data-panel-group-direction') === 'vertical');
      }
    };
    
    checkDirection();
    
    // Create a mutation observer to detect changes in direction
    const observer = new MutationObserver(checkDirection);
    
    if (handleRef.current) {
      observer.observe(handleRef.current.parentElement || document.body, {
        attributes: true,
        attributeFilter: ['data-panel-group-direction'],
        subtree: true
      });
    }
    
    return () => observer.disconnect();
  }, []);

  const handleContainerStyle: React.CSSProperties = {
    zIndex: 10,
    display: 'flex',
    height: '16px',
    width: '12px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '2px',
    border: '1px solid var(--border-color, #e5e7eb)',
    backgroundColor: 'var(--border-color, #e5e7eb)',
    transform: isVertical ? 'rotate(90deg)' : undefined,
  };

  const gripStyle: React.CSSProperties = {
    height: '10px',
    width: '10px',
    color: 'var(--text-color, #6b7280)',
  };

  return (
    <div ref={handleRef} style={{ display: 'contents' }}>
      <ResizablePrimitive.PanelResizeHandle
        style={{
          position: 'relative', 
          display: 'flex',
          width: isVertical ? '100%' : '1px',
          height: isVertical ? '1px' : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--border-color, #e5e7eb)',
          ...style,
        }}
        {...props}
      >
        {withHandle && (
          <div style={handleContainerStyle}>
            <GripIcon style={gripStyle} />
          </div>
        )}
      </ResizablePrimitive.PanelResizeHandle>
    </div>
  );
};

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
