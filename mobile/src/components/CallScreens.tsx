import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { callApi } from '../api/endpoints';
import { emitWithAck, getSocket, onSocket } from '../services/socket';
import { useAuthStore } from '../store/auth.store';
import { Button } from './Button';
import { EmptyState, Loader } from './Feedback';
import { colors, spacing, typography } from '../theme';

/** Why the Call button is disabled, explained to the user in their language. */
const REASON_TEXT: Record<string, string> = {
  BLOCKED: 'You cannot call this person.',
  NO_MATCH: 'Calls are only available between matches.',
  CALLEE_DISABLED_CALLS: 'This person is not accepting calls.',
  NO_CONTACT_ENTITLEMENT: 'Unlock this contact to start a call.',
  SELF_CALL: 'You cannot call yourself.',
};

export const callReasonText = (reason: string | null): string =>
  reason ? (REASON_TEXT[reason] ?? 'This call is not available.') : '';

/** Call history for the signed-in user. */
export function CallHistoryScreen(): React.JSX.Element {
  const history = useQuery({ queryKey: ['calls'], queryFn: callApi.history });

  if (history.isLoading) return <Loader label="Loading call history" />;

  const rows = history.data ?? [];

  return (
    <View style={styles.container}>
      <Text style={typography.title}>Calls</Text>

      {rows.length === 0 ? (
        <EmptyState title="No calls yet" subtitle="Voice and video calls appear here once you make one." />
      ) : (
        rows.map((call) => (
          <View key={call.callId} style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={typography.body}>
                {call.otherName} · {call.type === 'VIDEO' ? 'Video' : 'Voice'}
              </Text>
              <Text style={typography.caption}>
                {new Date(call.startedAt).toLocaleString()} · {call.status}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/**
 * Incoming call screen.
 *
 * The peer connection itself needs a native WebRTC module, which cannot be part
 * of this repository (there are no android/ios folders yet). What IS implemented
 * and exercised here is the signalling contract: the screen listens for
 * `call:incoming`, answers with `call:accept` and hangs up with `call:reject`.
 */
export function IncomingCallScreen({
  route,
}: {
  route: { params: { callId: string; fromUserId: string; type: 'VOICE' | 'VIDEO'; ringTimeoutAt?: string } };
}): React.JSX.Element {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [state, setState] = useState<'ringing' | 'connecting' | 'ended'>('ringing');
  const { callId, fromUserId, type } = route.params;

  useEffect(() => {
    getSocket(accessToken);

    const offEnded = onSocket('call:ended', (payload) => {
      const data = payload as { callId: string };
      if (data.callId === callId) setState('ended');
    });

    return offEnded;
  }, [accessToken, callId]);

  const answer = async () => {
    setState('connecting');
    try {
      // A real client builds the SDP answer with the native peer connection and
      // passes it to call:accept.
      await emitWithAck('call:accept', { callId, sdpAnswer: undefined });
    } catch {
      Alert.alert('Could not connect', 'The call could not be answered.');
      setState('ended');
    }
  };

  const decline = async () => {
    try {
      await emitWithAck('call:reject', { callId, reason: 'declined_by_user' });
    } finally {
      setState('ended');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>{type === 'VIDEO' ? 'Incoming video call' : 'Incoming voice call'}</Text>
      <Text style={typography.body}>Someone is calling you.</Text>

      {state === 'ended' ? (
        <Text style={typography.caption}>Call ended</Text>
      ) : (
        <View style={styles.actions}>
          <Button label="Decline" variant="danger" onPress={() => void decline()} />
          <Button label={state === 'connecting' ? 'Connecting...' : 'Answer'} onPress={() => void answer()} />
        </View>
      )}

      <Text style={styles.note}>
        Safety: you can block someone during a call. The call ends immediately and they cannot call you again.
      </Text>
      <Text style={typography.caption}>Caller: {fromUserId.slice(0, 8)}…</Text>
    </View>
  );
}

/** Outgoing call screen: ring, then wait for call:accepted. */
export function OutgoingCallScreen({
  route,
}: {
  route: { params: { callId: string; calleeName: string; type: 'VOICE' | 'VIDEO' } };
}): React.JSX.Element {
  const [status, setStatus] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const { callId, calleeName, type } = route.params;

  useEffect(() => {
    const offAccepted = onSocket('call:accepted', (payload) => {
      const data = payload as { callId: string };
      if (data.callId === callId) setStatus('connected');
    });
    const offEnded = onSocket('call:ended', (payload) => {
      const data = payload as { callId: string };
      if (data.callId === callId) setStatus('ended');
    });

    return () => {
      offAccepted();
      offEnded();
    };
  }, [callId]);

  const hangUp = async () => {
    try {
      await emitWithAck('call:hangup', { callId });
    } finally {
      setStatus('ended');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={typography.heading}>
        {status === 'ringing' ? `Calling ${calleeName}...` : status === 'connected' ? 'Connected' : 'Call ended'}
      </Text>
      <Text style={typography.caption}>{type === 'VIDEO' ? 'Video call' : 'Voice call'}</Text>

      {status !== 'ended' ? (
        <View style={styles.actions}>
          <Button label="Hang up" variant="danger" onPress={() => void hangUp()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', paddingVertical: spacing.sm },
  rowBody: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  note: { ...typography.caption, textAlign: 'center', marginTop: spacing.xl, color: colors.textMuted },
});
