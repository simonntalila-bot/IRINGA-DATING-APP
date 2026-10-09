import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authApi, locationApi } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { Button } from '../../components/Button';
import { useCurrentLocation } from '../../location/useCurrentLocation';
import { colors, radius, spacing, typography } from '../../theme';
import type { AreaNode } from '../../types/api';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;

/** OTP verification (sign-up / sign-in) and password reset share this screen. */
export function OtpScreen({
  route,
}: {
  route: { params: { phone: string; mode: 'verify' | 'reset'; devCode?: string } };
}): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const setTokens = useAuthStore((s) => s.setTokens);
  const { phone, mode } = route.params;

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () => authApi.verifyOtp({ target: phone, code, purpose: 'PHONE_VERIFICATION' }),
    onSuccess: (tokens) => {
      if (mode === 'reset') {
        setResendMessage('Number verified. Set your new password below.');
        return;
      }
      void setTokens(tokens);
    },
    onError: (error: Error) => Alert.alert('Verification failed', error.message),
  });

  const reset = useMutation({
    mutationFn: () => authApi.resetPassword({ phone, code, newPassword }),
    onSuccess: () =>
      Alert.alert('Password updated', 'Sign in with your new password.', [
        { text: 'OK', onPress: () => navigation.replace('Login') },
      ]),
    onError: (error: Error) => Alert.alert('Could not reset password', error.message),
  });

  const resend = useMutation({
    mutationFn: () =>
      authApi.requestOtp({ target: phone, purpose: mode === 'reset' ? 'PASSWORD_RESET' : 'PHONE_VERIFICATION' }),
    onSuccess: (result) =>
      setResendMessage(result.devCode ? `Development code: ${result.devCode}` : 'A new code has been sent.'),
  });

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={typography.title}>{mode === 'reset' ? 'Reset password' : 'Verify your number'}</Text>
      <Text style={typography.caption}>We sent a 6 digit code to {phone}.</Text>

      {route.params.devCode ? <Text style={styles.devCode}>Development code: {route.params.devCode}</Text> : null}
      {resendMessage ? <Text style={styles.devCode}>{resendMessage}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="6 digit code"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />

      {mode === 'reset' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="New password"
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <Button
            label="Reset password"
            onPress={() => reset.mutate()}
            loading={reset.isPending}
            disabled={code.length < 4 || newPassword.length < 8}
          />
        </>
      ) : (
        <Button label="Verify" onPress={() => verify.mutate()} loading={verify.isPending} disabled={code.length < 4} />
      )}

      <Button label="Resend code" variant="ghost" onPress={() => resend.mutate()} loading={resend.isPending} />
      <Button label="Back" variant="ghost" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

/**
 * Location permission + area confirmation.
 *
 * Denial is a supported path: the user picks an area manually so discovery can
 * still work, just with lower accuracy.
 */
export function LocationSetupScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList, 'LocationSetup'>>();
  const { permission, detecting, detection, locate } = useCurrentLocation();
  const [manualMode, setManualMode] = useState(permission === 'denied');

  if (manualMode) {
    return <ManualAreaScreen onDone={() => navigation.navigate('ProfileSetup')} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={typography.title}>Where are you in Iringa?</Text>
      <Text style={styles.explainer}>
        We use your location to show people and places near you - like Kihesa, Gangilonga or Mkwawa. Other people only
        ever see the general area name, never your exact position.
      </Text>

      <Button label={detecting ? 'Locating...' : 'Allow location'} onPress={() => void locate()} loading={detecting} />

      {detection ? (
        <View style={styles.resultCard}>
          <Text style={typography.heading}>{detection.area?.name ?? 'Area not recognised yet'}</Text>
          {detection.inSupportedRegion ? (
            <Text style={typography.caption}>You are inside the served Iringa area. You can continue.</Text>
          ) : (
            <Text style={[typography.caption, { color: colors.danger }]}>
              {detection.reason ?? 'This app is currently available in Iringa only.'}
            </Text>
          )}
        </View>
      ) : null}

      <Button label="Continue" onPress={() => navigation.navigate('ProfileSetup')} />
      <Pressable style={styles.link} onPress={() => setManualMode(true)} accessibilityRole="button">
        <Text style={styles.linkText}>Choose my area manually</Text>
      </Pressable>
    </ScrollView>
  );
}

function ManualAreaScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['areas', search],
    queryFn: () => locationApi.areas(search ? { search } : {}),
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (nodeId: string) => locationApi.manualArea(nodeId),
    onSuccess: onDone,
    onError: (error: Error) => Alert.alert('Could not save area', error.message),
    onMutate: () => setSaving(true),
  });

  const areas = data ?? [];

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={typography.title}>Choose your area</Text>
      <Text style={styles.explainer}>
        Without GPS we can still show you people in the areas you pick. Discovery accuracy will be lower.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Search Kihesa, Mkwawa, ..."
        value={search}
        onChangeText={setSearch}
      />

      {areas.length === 0 ? (
        <Text style={typography.caption}>No areas configured yet. An admin can add them from the panel.</Text>
      ) : (
        <View style={styles.chipRow}>
          {areas.map((area: AreaNode) => (
            <Text
              key={area.id}
              onPress={() => setSelected(area.id)}
              style={[styles.chip, selected === area.id && styles.chipActive]}
            >
              {area.name}
            </Text>
          ))}
        </View>
      )}

      <Button
        label="Save and continue"
        onPress={() => selected && save.mutate(selected)}
        loading={saving}
        disabled={!selected}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: spacing.lg, gap: spacing.md },
  explainer: { ...typography.body, marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  resultCard: { backgroundColor: colors.backgroundAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  devCode: { color: colors.accent, fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { color: colors.primary, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textMuted,
    fontSize: 13,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary, color: '#fff' },
});
