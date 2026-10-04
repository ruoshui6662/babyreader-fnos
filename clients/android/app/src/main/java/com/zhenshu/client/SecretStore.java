package com.zhenshu.client;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the access password so an expired sign-in can be renewed without
 * asking again. The password is encrypted with an AES key that lives in the
 * Android Keystore and never leaves it; only the ciphertext is stored.
 */
final class SecretStore {
    private static final String KEY_ALIAS = "zhenshu-access-password";
    private static final String PREF = "accessPassword";

    private final SharedPreferences prefs;

    SecretStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    void save(String password) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] sealed = cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
            String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
            prefs.edit().putString(PREF, value).apply();
        } catch (Exception error) {
            // Without a usable keystore the password is simply not kept:
            // an expired sign-in then asks again.
            clear();
        }
    }

    String load() {
        String value = prefs.getString(PREF, null);
        if (value == null || !value.contains(":")) return null;
        try {
            String[] parts = value.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    void clear() {
        prefs.edit().remove(PREF).apply();
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }
}
