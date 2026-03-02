/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Firestore, FieldValue } from '@google-cloud/firestore';

const firestore = new Firestore();

export async function checkUserPaired(email: string): Promise<boolean> {
  const doc = await firestore.collection('agents').doc(email).get();
  return doc.exists && doc.data()?.['paired'] === true;
}

export async function setUserPaired(email: string): Promise<void> {
  await firestore.collection('agents').doc(email).set(
    {
      paired: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
