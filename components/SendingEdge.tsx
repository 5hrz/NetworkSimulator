import React from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export type GetSendingEdgeParams = {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
};

export const getSendingEdgePath = ({ sourceX, sourceY, targetX, targetY }: { sourceX: number, sourceY: number, targetX: number, targetY: number }, offset: number) => {
    const centerX = (sourceX + targetX) / 2;
    const centerY = (sourceY + targetY) / 2;

    return `M ${sourceX} ${sourceY} Q ${centerX} ${centerY + offset} ${targetX} ${targetY}`;
};

export default function SendingEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    animated
}: EdgeProps) {
    const rand = Math.random() * 20 - 10;
    const edgePath = getSendingEdgePath({ sourceX, sourceY, targetX, targetY }, rand * Math.abs(rand));

    return (
        <>
            <BaseEdge id={id} path={edgePath} style={style} markerEnd='arrow' />
            <circle r="2" fill="#44ff44">
                <animateMotion dur={animated ? "0.5s" : "0.1s"} repeatCount={animated ? "indefinite" : 2} path={edgePath} markerEnd={markerEnd} />
            </circle>
        </>
    );
}