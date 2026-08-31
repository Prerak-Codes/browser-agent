import type {
    SensitiveRegion
} from "./privacy";

import type {
    PrivacyType
} from "./privacy";

export interface SanitizedContext {
    task: string;
    sanitizedImage?: string;
    detectedElements: string[];
    privacySummary: {
        totalSensitiveRegions: number;
        types: string[];
    };
}

const FIELD_KEYWORDS: Record<
    string,
    string[]
> = {
    name_field: [
        "name",
        "username",
        "first",
        "last",
        "full"
    ],
    email_field: [
        "email",
        "e-mail",
        "mail"
    ],
    password_field: [
        "password",
        "passcode",
        "passwd",
        "pwd",
        "pin",
        "secret"
    ],
    phone_field: [
        "phone",
        "mobile",
        "tel",
        "contact"
    ],
    credit_card_field: [
        "card",
        "credit",
        "debit",
        "payment"
    ],
    submit_button: [
        "submit",
        "save",
        "send",
        "confirm",
        "ok",
        "apply"
    ],
    login_button: [
        "login",
        "sign in",
        "signin",
        "log in"
    ],
    address_field: [
        "address",
        "street",
        "city",
        "zip",
        "postal"
    ]
};

function inferElements(
    ocrTexts: string[]
): string[] {

    const elements: string[] = [];

    const allText =
        ocrTexts
            .join(" ")
            .toLowerCase();

    for (
        const [field, keywords] of
        Object.entries(FIELD_KEYWORDS)
    ) {

        const found =
            keywords.some(
                (kw) =>
                    allText.includes(kw)
            );

        if (found) {
            elements.push(field);
        }

    }

    return elements;
}

function collectOCRTexts(
    sensitiveRegions: SensitiveRegion[]
): string[] {

    const texts: string[] = [];

    for (
        const region of
        sensitiveRegions
    ) {

        if (
            region.text &&
            region.text.length > 0
        ) {
            texts.push(region.text);
        }

    }

    return texts;
}

export function buildSanitizedContext(
    task: string,
    sensitiveRegions: SensitiveRegion[],
    sanitizedImage?: string
): SanitizedContext {

    const types: string[] = [];

    const typeSet = new Set<PrivacyType>();

    for (
        const region of
        sensitiveRegions
    ) {

        if (
            !typeSet.has(region.type)
        ) {
            typeSet.add(region.type);
            types.push(region.type);
        }

    }

    const ocrTexts =
        collectOCRTexts(
            sensitiveRegions
        );

    const detectedElements =
        inferElements(ocrTexts);

    return {
        task,
        sanitizedImage,
        detectedElements,
        privacySummary: {
            totalSensitiveRegions:
                sensitiveRegions.length,
            types
        }
    };
}
