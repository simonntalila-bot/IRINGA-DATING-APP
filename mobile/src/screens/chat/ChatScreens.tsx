import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { chatApi } from '../../api/endpoints';
import { emitWithAck, getSocket, onSocket } from '../../services/socket';
import { useAuthStore } from '../../store/auth.store';
import { Loader, RemoteImage } from '../../components/Feedback';
import { colors, radius, spacing, typography } from '../../theme';
import type { ConversationListItem, Message } from '../../types/api';
import type { MainStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList>;

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

export function ChatListScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const accessToken = useAuthStore((s) => s.accessToken);

  const query = useQuery({
    queryKey: ['conversations'],
    queryFn: chatApi.conversations,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    getSocket(accessToken);
    const off = onSocket('message:new', () => {
      void query.refetch();
    });
    return off;
  }, [accessToken, query]);

  if (query.isLoading) return <Loader label="Loading your conversations" />;

  const items = query.data ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.conversationId}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={typography.heading}>No conversations yet</Text>
          <Text style={typography.caption}>When you and someone else both like each other, the chat opens here.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate('Tabs', {
              screen: 'Messages',
              params: { conversationId: item.conversationId },
            })
          }
          accessibilityRole="button"
        >
          <RemoteImage uri={null} style={styles.avatar} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{item.other.displayName}</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {item.lastMessage?.body ?? (item.lastMessage ? `[${item.lastMessage.kind.toLowerCase()}]` : 'Say hello')}
            </Text>
          </View>
          {item.unreadMessages > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unreadMessages}</Text>
            </View>
          ) : null}
        </Pressable>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Single conversation
// ---------------------------------------------------------------------------

interface ChatScreenProps {
  route: { params: { conversationId: string; title?: string } };
}

export function ChatScreen({ route }: ChatScreenProps): React.JSX.Element {
  const { conversationId } = route.params;
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [draft, setDraft] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [online, setOnline] = useState(false);

  const history = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => chatApi.messages(conversationId),
  });

  const send = useMutation({
    mutationFn: (body: { body: string; clientId: string }) => chatApi.send({ conversationId, ...body }),
    onSuccess: (message) => {
      queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => [...old, message]);
      setDraft('');
    },
    onError: (error: Error) => {
      // Never claim delivery the server has not confirmed.
      void error;
    },
  });

  const markRead = useCallback(() => {
    void chatApi.markRead(conversationId).catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    const socket = getSocket(accessToken);
    if (!socket) return undefined;

    void emitWithAck('conversation:join', { conversationId }).catch(() => undefined);
    markRead();

    const offMessage = onSocket('message:new', (payload) => {
      const message = payload as Message;
      if (message.conversationId !== conversationId) return;
      queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) =>
        old.some((m) => m.id === message.id) ? old : [...old, message],
      );
      markRead();
    });

    const offTyping = onSocket('typing', (payload) => {
      const data = payload as { conversationId: string; userId: string; isTyping: boolean };
      if (data.conversationId !== conversationId) return;
      setTypingUsers((prev) =>
        data.isTyping ? [...new Set([...prev, data.userId])] : prev.filter((id) => id !== data.userId),
      );
    });

    const offPresence = onSocket('presence', () => setOnline(true));

    return () => {
      offMessage();
      offTyping();
      offPresence();
    };
  }, [accessToken, conversationId, markRead, queryClient]);

  const messages = useMemo(() => history.data ?? [], [history.data]);

  const onChangeDraft = (value: string) => {
    setDraft(value);
    const socket = getSocket(accessToken);
    if (socket)
      void emitWithAck('message:typing', { conversationId, isTyping: value.length > 0 }).catch(() => undefined);
  };

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    send.mutate({ body, clientId: `${Date.now()}` });
  };

  if (history.isLoading) return <Loader />;

  return (
    <KeyboardAvoidingView
      style={styles.chat}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {item.replyTo ? (
              <Text style={styles.replyTo} numberOfLines={1}>
                ↩ {item.replyTo.senderName}: {item.replyTo.body ?? item.replyTo.kind}
              </Text>
            ) : null}
            <Text style={item.isMine ? styles.bubbleTextMine : styles.bubbleText}>{item.body ?? `[${item.kind}]`}</Text>
            <Text style={styles.bubbleMeta}>
              {new Date(item.createdAt).toLocaleTimeString()}
              {item.isMine && item.reactions.length > 0 ? `  ${item.reactions.map((r) => r.emoji).join('')}` : ''}
            </Text>
          </View>
        )}
      />

      {typingUsers.length > 0 ? <Text style={styles.typing}>typing…</Text> : null}
      {online ? <Text style={styles.typing}>online</Text> : null}

      <View style={styles.composer}>
        <TextInput style={styles.input} placeholder="Message" value={draft} onChangeText={onChangeDraft} multiline />
        <Pressable style={styles.send} onPress={submit} accessibilityRole="button" accessibilityLabel="Send message">
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export const conversationSummary = (item: ConversationListItem): string =>
  `${item.other.displayName} · ${item.unreadMessages} unread`;

const styles = StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm },
  empty: { padding: spacing.lg, alignItems: 'center', gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: radius.pill },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.body, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  chat: { flex: 1 },
  messages: { padding: spacing.md, gap: spacing.xs },
  bubble: { maxWidth: '80%', padding: spacing.sm, borderRadius: radius.md, marginVertical: 2 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: { color: colors.text, fontSize: 15 },
  bubbleTextMine: { color: '#fff', fontSize: 15 },
  bubbleMeta: { fontSize: 10, opacity: 0.7, marginTop: 2, alignSelf: 'flex-end' },
  replyTo: { fontSize: 11, opacity: 0.8, marginBottom: 2 },
  typing: { ...typography.caption, paddingHorizontal: spacing.md, fontStyle: 'italic' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 120,
    color: colors.text,
  },
  send: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sendText: { color: '#fff', fontWeight: '700' },
});
