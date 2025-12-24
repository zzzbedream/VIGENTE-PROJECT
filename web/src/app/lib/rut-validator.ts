// src/lib/rut-validator.ts

export class RutValidator {
  // Limpia el RUT dejando solo números, K y guión
  static clean(rut: string): string {
    return rut.replace(/[^0-9kK\-]/g, '').toUpperCase();
  }

  // Valida el formato básico del RUT (ej: 12345678-K)
  static validateFormat(rut: string): { valid: boolean; error?: string } {
    const cleanRut = this.clean(rut);
    
    // Debe contener exactamente un guión
    if (!cleanRut.includes('-')) {
      return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
    }

    const parts = cleanRut.split('-');
    if (parts.length !== 2) {
      return { valid: false, error: "Formato inválido. Usa el formato: 12345678-K" };
    }

    const [num, dv] = parts;

    // El número debe tener entre 7 y 8 dígitos
    if (!/^\d{7,8}$/.test(num)) {
      return { valid: false, error: "El RUT debe tener 7 u 8 dígitos antes del guión" };
    }

    // El DV debe ser un dígito (0-9) o K
    if (!/^[0-9K]$/.test(dv)) {
      return { valid: false, error: "El dígito verificador debe ser un número (0-9) o K" };
    }

    return { valid: true };
  }

  // Valida formato + dígito verificador matemáticamente
  static validate(rut: string): boolean {
    const formatCheck = this.validateFormat(rut);
    if (!formatCheck.valid) return false;

    const cleanRut = this.clean(rut);
    const [num, dv] = cleanRut.split('-');

    // Cálculo del dígito verificador (Módulo 11)
    let sum = 0;
    let mul = 2;

    for (let i = num.length - 1; i >= 0; i--) {
      sum += parseInt(num.charAt(i)) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }

    const expected = 11 - (sum % 11);
    let validDv: string;
    
    if (expected === 11) validDv = '0';
    else if (expected === 10) validDv = 'K';
    else validDv = expected.toString();

    return validDv === dv.toUpperCase();
  }

  // Valida y retorna error descriptivo
  static validateWithError(rut: string): { valid: boolean; error?: string } {
    // Primero validar formato
    const formatCheck = this.validateFormat(rut);
    if (!formatCheck.valid) {
      return formatCheck;
    }

    // Luego validar DV
    if (!this.validate(rut)) {
      return { valid: false, error: "Dígito verificador incorrecto. Verifica tu RUT" };
    }

    return { valid: true };
  }
}