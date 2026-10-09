import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

export function Loader({ label }: { label?: string }): React.JSX.Element {
  return (
    <View style={styles.center} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? (
        <Text style={styles.retry} onPress={onRetry}>
          Try again
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }): React.JSX.Element {
  return (
    <View style={styles.center}>
      <Text style={typography.heading}>{title}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </View>
  );
}

export function OfflineBanner({ visible }: { visible: boolean }): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>You are offline. Messages will send when you reconnect.</Text>
    </View>
  );
}

/** Skeleton block used while a card is loading. */
export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | `${number}%`;
}): React.JSX.Element {
  return <View style={[styles.skeleton, { height, width }]} />;
}

export function RemoteImage({ uri, style }: { uri: string | null | undefined; style?: object }): React.JSX.Element {
  if (!uri) {
    return <View style={[styles.placeholder, style]} />;
  }
  return <Image source={{ uri }} style={[styles.image, style]} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  muted: { ...typography.caption, textAlign: 'center' },
  errorTitle: { ...typography.heading, color: colors.danger },
  retry: { marginTop: spacing.sm, color: colors.primary, fontWeight: '600' },
  banner: { backgroundColor: colors.accent, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  bannerText: { color: '#422006', fontSize: 12, textAlign: 'center' },
  skeleton: { backgroundColor: colors.border, borderRadius: radius.sm, opacity: 0.6 },
  placeholder: { backgroundColor: colors.border, borderRadius: radius.md },
  image: { borderRadius: radius.md },
});
