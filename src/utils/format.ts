import type { ConnectionState } from '@/types/bluetooth';
import type { CarStatus } from '@/types/commands';

export function describeCarStatus(status: CarStatus): string {
  switch (status.state) {
    case 'moving':
      return status.command ? `Moving ${status.command}` : 'Moving';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function describeConnection(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    default:
      return 'Demo Mode';
  }
}
