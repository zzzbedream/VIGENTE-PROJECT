/**
 * Vigente Protocol — Claim Evaluator
 * 
 * Evaluates financial predicate claims against aggregate bank data.
 * Supports solvency predicates like:
 *   - "monthly_income > 1000 USD"
 *   - "inflow_count > 10"
 *   - "consistency > 0.7"
 * 
 * The evaluator operates on raw movement data and produces a
 * claim verdict (true/false) along with the aggregate metrics
 * used for evaluation (without revealing individual transactions).
 */

const CLP_TO_USD = 950; // Approximate CLP/USD exchange rate

class ClaimEvaluator {
  /**
   * Compute aggregate financial metrics from Fintoc movements.
   * @param {Array} movements - Array of Fintoc movement objects
   * @returns {object} Aggregate metrics
   */
  static computeMetrics(movements) {
    // Identify deposits (income)
    const deposits = movements.filter(m => m.type === 'deposit');
    const totalDepositsCLP = deposits.reduce((sum, m) => sum + m.amount, 0);
    const totalDepositsUSD = totalDepositsCLP / CLP_TO_USD;
    const monthlyIncomeUSD = totalDepositsUSD / 6; // 6-month window

    // Identify merchant payouts (Payku settlements)
    const merchantPayouts = movements.filter(m =>
      (m.type === 'deposit' || m.type === 'transfer_in') && m.description.includes('Payku')
    );
    // Fallback: treat remaining inflows as commercial activity when description varies
    const inflows = merchantPayouts.length > 0
      ? merchantPayouts
      : movements.filter(m => m.amount > 0);
    const totalInflowCLP = inflows.reduce((sum, m) => sum + Math.abs(m.amount), 0);
    const totalInflowUSD = totalInflowCLP / CLP_TO_USD;
    const monthlyInflowUSD = totalInflowUSD / 6;

    // Compute consistency (inverse coefficient of variation)
    const monthlyAmounts = {};
    inflows.forEach(m => {
      const month = m.date.substring(0, 7);
      if (!monthlyAmounts[month]) monthlyAmounts[month] = 0;
      monthlyAmounts[month] += Math.abs(m.amount);
    });
    const monthValues = Object.values(monthlyAmounts);
    const mean = monthValues.reduce((s, v) => s + v, 0) / monthValues.length;
    const variance = monthValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / monthValues.length;
    const stdDev = Math.sqrt(variance);
    const coeffOfVariation = mean > 0 ? stdDev / mean : 1;
    const consistency = Math.max(0, Math.min(1, 1 - coeffOfVariation));

    return {
      monthly_income_usd: Math.round(monthlyIncomeUSD * 100) / 100,
      monthly_inflow_usd: Math.round(monthlyInflowUSD * 100) / 100,
      inflow_count: inflows.length,
      total_movements: movements.length,
      consistency: Math.round(consistency * 1000) / 1000,
      months_analyzed: 6,
    };
  }

  /**
   * Evaluate a predicate claim against computed metrics.
   * @param {string} predicate - Claim string, e.g., "monthly_income > 1000 USD"
   * @param {object} metrics - Output of computeMetrics()
   * @returns {{ predicate: string, result: boolean, evaluated_value: number }}
   */
  static evaluateClaim(predicate, metrics) {
    // Parse predicate: "field > value [UNIT]"
    const match = predicate.match(/^(\w+)\s*(>|>=|<|<=|==)\s*([\d.]+)\s*(\w+)?$/);
    if (!match) {
      throw new Error(`Invalid predicate format: "${predicate}". Expected: "field > value [UNIT]"`);
    }

    const [, field, operator, valueStr] = match;
    const threshold = parseFloat(valueStr);

    // Map predicate field to metric
    const fieldMap = {
      'monthly_income': metrics.monthly_income_usd,
      'monthly_inflow': metrics.monthly_inflow_usd,
      'inflow_count': metrics.inflow_count,
      'consistency': metrics.consistency,
    };

    const actualValue = fieldMap[field];
    if (actualValue === undefined) {
      throw new Error(`Unknown predicate field: "${field}". Valid: ${Object.keys(fieldMap).join(', ')}`);
    }

    // Evaluate
    let result;
    switch (operator) {
      case '>':  result = actualValue > threshold; break;
      case '>=': result = actualValue >= threshold; break;
      case '<':  result = actualValue < threshold; break;
      case '<=': result = actualValue <= threshold; break;
      case '==': result = actualValue === threshold; break;
      default: throw new Error(`Unsupported operator: "${operator}"`);
    }

    return {
      predicate,
      result,
      evaluated_value: actualValue,
      threshold,
      operator,
    };
  }

  /**
   * Get all supported predicates for documentation.
   */
  static getSupportedPredicates() {
    return [
      'monthly_income > 1000 USD',
      'monthly_income > 500 USD',
      'monthly_inflow > 500 USD',
      'inflow_count > 10',
      'consistency > 0.7',
    ];
  }
}

module.exports = ClaimEvaluator;
