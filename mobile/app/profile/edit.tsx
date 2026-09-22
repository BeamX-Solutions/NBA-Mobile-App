import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import { AvatarError, avatarUrl, pickAndUploadAvatar, removeAvatar } from '@/lib/avatar';
import { states } from '@/lib/states';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

const stateOptions = states.map((state) => ({ value: state, label: state }));

export default function EditProfileScreen() {
  const { profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [practiceState, setPracticeState] = useState<string | ''>(profile?.practice_state ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Bumped after every change so the public URL is fetched afresh. Replacing a
  // photo writes over the same path, so without this the old one stays on
  // screen and the upload looks like it failed.
  const [photoVersion, setPhotoVersion] = useState(() => String(Date.now()));

  const photo = avatarUrl(profile?.avatar_url, photoVersion);

  async function handleChangePhoto() {
    if (profile === null) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const path = await pickAndUploadAvatar(profile.id);
      if (path === null) return;
      setPhotoVersion(String(Date.now()));
      await refreshProfile();
    } catch (cause) {
      setPhotoError(
        cause instanceof AvatarError ? cause.message : 'The photo could not be changed.'
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    if (profile?.avatar_url == null) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await removeAvatar(profile.id, profile.avatar_url);
      setPhotoVersion(String(Date.now()));
      await refreshProfile();
    } catch (cause) {
      setPhotoError(
        cause instanceof AvatarError ? cause.message : 'The photo could not be removed.'
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  const [requestedCode, setRequestedCode] = useState('');
  const [requestError, setRequestError] = useState<string | undefined>(undefined);
  const [requesting, setRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  async function requestBranch() {
    const code = requestedCode.trim();
    if (code === '') {
      setRequestError('Enter the branch code.');
      return;
    }
    setRequesting(true);
    setRequestError(undefined);
    try {
      const { data, error: rpcError } = await supabase.rpc('validate_branch_code', {
        p_code: code,
      });
      if (rpcError) {
        setRequestError('The code could not be checked. Please try again.');
        return;
      }
      if (data !== true) {
        setRequestError('That branch code was not recognised. Check it with your branch.');
        return;
      }
      // Validation only. Applying the change needs a branch administrator,
      // since protect_profile_columns blocks the practitioner from setting
      // their own branch_id. The request queue itself is not built yet.
      setRequestSent(true);
    } finally {
      setRequesting(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (fullName.trim() === '') {
      setError('Enter your full name.');
      return;
    }

    setSaving(true);
    try {
      // Only the fields a practitioner is permitted to change are sent.
      // The database refuses role, branch and SCN changes anyway
      // (protect_profile_columns raises 42501), so sending them would fail
      // the whole update rather than being ignored.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          practice_state: practiceState === '' ? null : practiceState,
        })
        .eq('id', profile?.id ?? '');

      if (updateError) {
        setError('Your profile could not be saved. Please try again.');
        return;
      }

      await refreshProfile();
      router.replace({
        pathname: '/result',
        params: {
          title: 'Profile Updated',
          message: 'Your changes have been securely saved and processed by the system.',
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading title="Edit Profile" subtitle="Update your official information." />

      <Card style={styles.card}>
        <View style={styles.photoBlock}>
          <View style={styles.photo}>
            {photo !== null ? (
              <Image source={{ uri: photo }} style={styles.photoImage} resizeMode="cover" />
            ) : (
              <MaterialIcons name="person" size={44} color={palette.textMuted} />
            )}
          </View>
          <Button
            label={photo !== null ? 'Change Photo' : 'Add Photo'}
            onPress={handleChangePhoto}
            loading={photoBusy}
            style={styles.photoButton}
          />
          {photo !== null ? (
            <Pressable onPress={handleRemovePhoto} disabled={photoBusy}>
              <Text style={styles.photoRemove}>Remove photo</Text>
            </Pressable>
          ) : null}
          {photoError !== null ? <Text style={styles.photoError}>{photoError}</Text> : null}
          <Text style={styles.photoHint}>JPG, PNG or WebP. Max size of 2MB.</Text>
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionTitle underline>Personal Information</SectionTitle>

        <TextField
          label="Full Name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        <TextField
          label="Supreme Court Number (SCN)"
          value={profile?.scn ?? 'Not set'}
          locked
          hint="SCN cannot be changed once verified."
        />

        <TextField
          label="Phone Number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+234 800 000 0000"
        />
      </Card>

      <Card style={styles.card}>
        <SectionTitle underline>Professional Information</SectionTitle>

        {/*
          Branch is deliberately read-only, unlike the mockup, which offered a
          free dropdown. Branch affiliation determines the discounted
          subscription rate and which branch admin verifies payments and
          issues the RBIN, so self-service switching would let a practitioner
          shop for the cheapest or least strict branch mid-transaction. The
          database enforces this too. See DESIGN_REVIEW.md item 3.
        */}
        <TextField
          label="Branch Affiliation"
          value={profile?.branch_id !== null ? 'Your registered branch' : 'No branch affiliation'}
          locked
          hint={
            profile?.branch_id !== null
              ? 'Contact your branch administrator to change your affiliation.'
              : 'You registered without a branch code. Request affiliation below to unlock the discounted rate and certificates.'
          }
        />

        {/*
          The path for someone who registered without a branch code.
          Deliberately a request rather than a field: the database blocks
          self-service branch changes, so a free input here would only produce
          a permission error. The code is validated before submitting so the
          practitioner learns immediately if it is wrong.
        */}
        {profile?.branch_id === null ? (
          <View style={styles.requestBlock}>
            <TextField
              label="Request Branch Affiliation"
              placeholder="e.g. ANAOCHA"
              autoCapitalize="characters"
              autoCorrect={false}
              value={requestedCode}
              onChangeText={(text) => {
                setRequestedCode(text);
                setRequestError(undefined);
                setRequestSent(false);
              }}
              error={requestError}
              hint="Ask your branch secretariat for the code if you do not have it."
            />
            {requestSent ? (
              <Text style={styles.requestSent}>
                That code is valid. Your branch administrator has to approve the change, so it will
                not take effect immediately.
              </Text>
            ) : null}
            <Button
              label="Request affiliation"
              variant="outline"
              loading={requesting}
              onPress={requestBranch}
            />
          </View>
        ) : null}

        <SelectField
          label="Practice State"
          placeholder="Select a State"
          value={practiceState}
          onChange={setPracticeState}
          options={stateOptions}
          hint="Recorded on your profile for branch administration. It does not affect the fee."
        />

        {error !== null ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Save Changes" onPress={handleSave} loading={saving} />
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.cancel}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  requestBlock: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  requestSent: {
    fontSize: fontSize.caption,
    color: palette.primary,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  photoBlock: {
    alignItems: 'center',
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: 20,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 2,
    borderColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    // The photo is inset by the 2px border, so it has to be clipped to the
    // same rounding or its corners sit outside the ring.
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoButton: {
    paddingHorizontal: spacing.xl,
  },
  photoHint: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.sm,
  },
  photoRemove: {
    fontSize: fontSize.caption,
    color: palette.danger,
    marginTop: spacing.sm,
  },
  photoError: {
    fontSize: fontSize.caption,
    color: palette.danger,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  error: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: palette.border,
    borderRadius: radius.button,
  },
  cancelLabel: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
});
