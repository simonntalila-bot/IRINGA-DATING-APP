import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authApi } from '../../api/endpoints';
import { useAuthStore } from '../../store/auth.store';
import { Button } from '../../components/Button';
import { colors, spacing, typography } from '../../theme';
import type { AuthStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

/** 18+ age gate. The server enforces it too - this is only the first screen. */
export function AgeGateScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={typography.title}>Iringa Dating</Text>
      <Text style={styles.body}>
        This app is for adults only. You must be at least 18 years old to create an account.
      </Text>

      <Text
        style={styles.body}
        onPress={() => setConfirmed((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
      >
        {confirmed ? '☑' : '☐'} I confirm that I am 18 years or older
      </Text>

      <Button label="Continue" onPress={() => navigation.navigate('Register')} disabled={!confirmed} />
    </View>
  );
}

export function LoginScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const setTokens = useAuthStore((s) => s.setTokens);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => authApi.login({ phone: phone.trim(), password }),
    onSuccess: (tokens) => void setTokens(tokens),
    onError: (error: Error & { payload?: { code?: string } }) => {
      if (error.payload?.code === 'PHONE_NOT_VERIFIED') {
        navigation.navigate('Otp', { phone: phone.trim(), mode: 'verify' });
        return;
      }
      Alert.alert('Cannot sign in', error.message);
    },
  });

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={typography.title}>Welcome back</Text>

      <TextInput
        style={styles.input}
        placeholder="Phone number (+255...)"
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Button label="Sign in" onPress={() => login.mutate()} loading={login.isPending} disabled={!phone || !password} />
      <Button label="Create an account" variant="secondary" onPress={() => navigation.navigate('Register')} />
      <Button
        label="Forgot password"
        variant="ghost"
        onPress={() => navigation.navigate('Otp', { phone, mode: 'reset' })}
      />
    </ScrollView>
  );
}

export function RegisterScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('FEMALE');
  const [goal, setGoal] = useState('SERIOUS_DATING');
  const [confirmed18, setConfirmed18] = useState(false);

  const register = useMutation({
    mutationFn: () =>
      authApi.register({
        phone: phone.trim(),
        password,
        displayName: displayName.trim(),
        dateOfBirth,
        gender,
        relationshipGoal: goal,
        confirm18Plus: true,
      }),
    onSuccess: (result) => {
      navigation.navigate('Otp', {
        phone: phone.trim(),
        mode: 'verify',
        devCode: result.otp.devCode ?? undefined,
      });
    },
    onError: (error: Error) => Alert.alert('Cannot register', error.message),
  });

  const canSubmit =
    phone.trim().length >= 9 &&
    password.length >= 8 &&
    displayName.trim().length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) &&
    confirmed18;

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={typography.title}>Create your profile</Text>

      <TextInput
        style={styles.input}
        placeholder="Phone number (+255...)"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        style={styles.input}
        placeholder="Password (min 8)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput style={styles.input} placeholder="Display name" value={displayName} onChangeText={setDisplayName} />
      <TextInput
        style={styles.input}
        placeholder="Date of birth (YYYY-MM-DD)"
        keyboardType="numbers-and-punctuation"
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
      />

      <Text style={styles.label}>I am</Text>
      <View style={styles.chipRow}>
        {['FEMALE', 'MALE', 'OTHER'].map((option) => (
          <Text
            key={option}
            onPress={() => setGender(option)}
            style={[styles.chip, gender === option && styles.chipActive]}
          >
            {option}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>Looking for</Text>
      <View style={styles.chipRow}>
        {['MARRIAGE', 'LONG_TERM', 'SERIOUS_DATING', 'FRIENDSHIP'].map((option) => (
          <Text
            key={option}
            onPress={() => setGoal(option)}
            style={[styles.chip, goal === option && styles.chipActive]}
          >
            {option.replace('_', ' ')}
          </Text>
        ))}
      </View>

      <Text
        style={styles.checkboxRow}
        onPress={() => setConfirmed18((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed18 }}
      >
        {confirmed18 ? '☑' : '☐'} I confirm that I am 18 years or older
      </Text>

      <Button label="Continue" onPress={() => register.mutate()} loading={register.isPending} disabled={!canSubmit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  form: { padding: spacing.lg, gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  label: { ...typography.caption, marginTop: spacing.sm },
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
  checkboxRow: { ...typography.body, marginVertical: spacing.md },
  body: { ...typography.body, marginBottom: spacing.lg },
});
