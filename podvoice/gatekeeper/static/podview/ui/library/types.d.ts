export type ComponentState = 'ready' | 'loading' | 'pending' | 'empty' | 'error' | 'offline' | 'unsupported';
export interface ActionContext {sessionId: string; taskId: string; revision: number; resourceId?: string}
export interface Option {id: string; label: string; detail?: string}
export interface ResourceAction {id: string; label: string; optionId?: string; enabled?: boolean}
export interface CommonData {state?: ComponentState; stateText?: string; quietStatus?: boolean; connected?: boolean; context?: ActionContext}
export interface ChoiceData extends CommonData {items: Option[]; selected?: string; checked?: string[]}
export interface TableData extends CommonData {caption: string; columns: {key: string; label: string}[]; items: ({id: string} & Record<string, string | number>)[]}
export interface ChartData extends CommonData {unit: string; items: {id: string; label: string; value: number}[]}
export interface StepData extends CommonData {steps: string[]; index: number}
export interface ResourceData extends CommonData {title: string; source?: string; text?: string; remaining?: number; actions: ResourceAction[]}
export interface SourceData extends CommonData {items: {id: string; label: string; url: string; scope: string}[]}
export interface VisualAction {type:'action.requested'; session_id: string | null; task_id: string | null; revision: number | null; resource_id: string | null; action_id: string; option_id: string | null; value?: number}
export interface PodViewComponent extends HTMLElement {data: CommonData | ChoiceData | TableData | ChartData | StepData | ResourceData | SourceData}
